import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import semver from "semver";

export type CargoDependencyVersionMismatch = {
	dependencyName: string;
	expectedVersionRequirement: string;
	actualVersionRequirement: string | null;
};

export function readManifestVersion(manifestPath: string): string {
	if (path.basename(manifestPath) === "package.json") {
		return readPackageJsonVersion(manifestPath);
	}

	if (path.basename(manifestPath) === "Cargo.toml") {
		return readCargoTomlVersion(manifestPath);
	}

	throw new Error(`Unsupported manifest file: ${manifestPath}`);
}

export function writeManifestVersion(
	manifestPath: string,
	nextVersionText: string,
): string {
	const parsedVersion = semver.parse(nextVersionText);
	if (!parsedVersion) {
		throw new Error(`Invalid release version: ${nextVersionText}`);
	}

	if (path.basename(manifestPath) === "package.json") {
		return writePackageJsonVersion(manifestPath, parsedVersion.version);
	}

	if (path.basename(manifestPath) === "Cargo.toml") {
		return writeCargoTomlVersion(manifestPath, parsedVersion.version);
	}

	throw new Error(`Unsupported manifest file: ${manifestPath}`);
}

export function collectCargoDependencyVersionMismatches(
	manifestPath: string,
	managedDependencyNames: Set<string>,
	expectedVersionRequirement: string,
): CargoDependencyVersionMismatch[] {
	if (path.basename(manifestPath) !== "Cargo.toml") {
		return [];
	}

	const source = readFileSync(manifestPath, "utf8");
	return collectCargoDependencyBlocks(source)
		.filter(
			(block) =>
				managedDependencyNames.has(block.dependencyName) &&
				block.blockText.includes("path = "),
		)
		.flatMap((block) => {
			const actualVersionRequirement = readCargoDependencyVersionRequirement(
				block.blockText,
			);
			if (actualVersionRequirement === expectedVersionRequirement) {
				return [];
			}

			return [
				{
					dependencyName: block.dependencyName,
					expectedVersionRequirement,
					actualVersionRequirement,
				},
			];
		});
}

export function writeCargoDependencyVersionRequirements(
	manifestPath: string,
	managedDependencyNames: Set<string>,
	expectedVersionRequirement: string,
): number {
	if (path.basename(manifestPath) !== "Cargo.toml") {
		return 0;
	}

	const source = readFileSync(manifestPath, "utf8");
	const eol = source.includes("\r\n") ? "\r\n" : "\n";
	const blocks = collectCargoDependencyBlocks(source);
	let nextSource = source;
	let updatedCount = 0;

	for (const block of [...blocks].reverse()) {
		if (
			!managedDependencyNames.has(block.dependencyName) ||
			!block.blockText.includes("path = ")
		) {
			continue;
		}

		const currentVersionRequirement = readCargoDependencyVersionRequirement(
			block.blockText,
		);
		if (currentVersionRequirement === expectedVersionRequirement) {
			continue;
		}

		const updatedBlockText = setCargoDependencyVersionRequirement(
			block.blockText,
			expectedVersionRequirement,
			eol,
		);
		nextSource =
			nextSource.slice(0, block.startOffset) +
			updatedBlockText +
			nextSource.slice(block.endOffset);
		updatedCount += 1;
	}

	if (updatedCount > 0) {
		writeFileSync(manifestPath, nextSource);
	}

	return updatedCount;
}

function readPackageJsonVersion(manifestPath: string): string {
	const source = readFileSync(manifestPath, "utf8");
	const parsed = JSON.parse(source) as { version?: unknown };
	const version = parsed.version;

	if (typeof version !== "string") {
		throw new Error(`Missing version in ${manifestPath}`);
	}

	const parsedVersion = semver.parse(version);
	if (!parsedVersion) {
		throw new Error(`Invalid semver version in ${manifestPath}: ${version}`);
	}

	return parsedVersion.version;
}

function writePackageJsonVersion(
	manifestPath: string,
	nextVersion: string,
): string {
	const source = readFileSync(manifestPath, "utf8");
	const parsed = JSON.parse(source) as { version?: unknown };
	const currentVersion = parsed.version;

	if (typeof currentVersion !== "string") {
		throw new Error(`Missing version in ${manifestPath}`);
	}

	const currentParsedVersion = semver.parse(currentVersion);
	if (!currentParsedVersion) {
		throw new Error(
			`Invalid semver version in ${manifestPath}: ${currentVersion}`,
		);
	}

	if (currentParsedVersion.version === nextVersion) {
		return currentParsedVersion.version;
	}

	const updatedSource = source.replace(
		`"version": "${currentVersion}"`,
		`"version": "${nextVersion}"`,
	);

	if (updatedSource === source) {
		throw new Error(`Unable to update version in ${manifestPath}`);
	}

	writeFileSync(manifestPath, updatedSource);

	return currentParsedVersion.version;
}

function readCargoTomlVersion(manifestPath: string): string {
	const source = readFileSync(manifestPath, "utf8");
	const packageVersion = readCargoPackageVersion(source, manifestPath);
	const parsedVersion = semver.parse(packageVersion);

	if (!parsedVersion) {
		throw new Error(
			`Invalid semver version in ${manifestPath}: ${packageVersion}`,
		);
	}

	return parsedVersion.version;
}

function writeCargoTomlVersion(
	manifestPath: string,
	nextVersion: string,
): string {
	const source = readFileSync(manifestPath, "utf8");
	const currentVersion = readCargoPackageVersion(source, manifestPath);
	const parsedCurrentVersion = semver.parse(currentVersion);

	if (!parsedCurrentVersion) {
		throw new Error(
			`Invalid semver version in ${manifestPath}: ${currentVersion}`,
		);
	}

	if (parsedCurrentVersion.version === nextVersion) {
		return parsedCurrentVersion.version;
	}

	const eol = source.includes("\r\n") ? "\r\n" : "\n";
	const lines = source.split(/\r?\n/u);
	let inPackageSection = false;
	let replaced = false;

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const trimmed = line.trim();

		if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
			inPackageSection = trimmed === "[package]";
			continue;
		}

		if (!inPackageSection || !trimmed.startsWith("version = ")) {
			continue;
		}

		const indentation = line.slice(0, line.length - line.trimStart().length);
		lines[index] = `${indentation}version = ${JSON.stringify(nextVersion)}`;
		replaced = true;
		break;
	}

	if (!replaced) {
		throw new Error(`Unable to update version in ${manifestPath}`);
	}

	writeFileSync(manifestPath, lines.join(eol));

	return parsedCurrentVersion.version;
}

function readCargoPackageVersion(source: string, manifestPath: string): string {
	const lines = source.split(/\r?\n/u);
	let inPackageSection = false;

	for (const line of lines) {
		const trimmed = line.trim();

		if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
			inPackageSection = trimmed === "[package]";
			continue;
		}

		if (!inPackageSection || !trimmed.startsWith("version = ")) {
			continue;
		}

		const version = trimmed.slice("version = ".length).trim();
		return JSON.parse(version) as string;
	}

	throw new Error(`Missing [package].version in ${manifestPath}`);
}

type CargoDependencyBlock = {
	dependencyName: string;
	blockText: string;
	startOffset: number;
	endOffset: number;
};

function collectCargoDependencyBlocks(source: string): CargoDependencyBlock[] {
	const blocks: CargoDependencyBlock[] = [];
	const blockStartRegex = /^(\s*)(securitydept-[A-Za-z0-9-]+)\s*=\s*\{/gmu;
	let match = blockStartRegex.exec(source);

	while (match) {
		const dependencyName = match[2];
		const startOffset = match.index;
		let offset = match.index;
		let braceDepth = 0;
		let foundOpeningBrace = false;

		while (offset < source.length) {
			const char = source[offset];
			if (char === "{") {
				braceDepth += 1;
				foundOpeningBrace = true;
			}
			if (char === "}") {
				braceDepth -= 1;
				if (foundOpeningBrace && braceDepth === 0) {
					offset += 1;
					break;
				}
			}
			offset += 1;
		}

		blocks.push({
			dependencyName,
			blockText: source.slice(startOffset, offset),
			startOffset,
			endOffset: offset,
		});
		blockStartRegex.lastIndex = offset;
		match = blockStartRegex.exec(source);
	}

	return blocks;
}

function readCargoDependencyVersionRequirement(
	blockText: string,
): string | null {
	const versionMatch = blockText.match(
		/(^|\{|,|\n)\s*version\s*=\s*"([^"]+)"/u,
	);
	return versionMatch?.[2] ?? null;
}

function setCargoDependencyVersionRequirement(
	blockText: string,
	expectedVersionRequirement: string,
	eol: string,
): string {
	const versionPattern = /(^|\{|,|\n)(\s*)version\s*=\s*"[^"]+"/u;
	if (versionPattern.test(blockText)) {
		return blockText.replace(
			versionPattern,
			(_match, prefix: string, indentation: string) =>
				`${prefix}${indentation}version = ${JSON.stringify(expectedVersionRequirement)}`,
		);
	}

	if (!blockText.includes(eol)) {
		return blockText.replace(
			"{",
			`{ version = ${JSON.stringify(expectedVersionRequirement)},`,
		);
	}

	const openBraceIndex = blockText.indexOf("{");
	const lineIndentationMatch = blockText.match(
		/^(\s*)securitydept-[A-Za-z0-9-]+/u,
	);
	const lineIndentation = lineIndentationMatch?.[1] ?? "";
	const entryIndentation = `${lineIndentation}    `;

	return `${blockText.slice(0, openBraceIndex + 1)}${eol}${entryIndentation}version = ${JSON.stringify(expectedVersionRequirement)},${blockText.slice(openBraceIndex + 1)}`;
}
