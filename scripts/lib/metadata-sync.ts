import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
	loadSecuritydeptMetadata,
	type NodePackageMetadata,
	type RustPackageMetadata,
} from "./metadata.ts";
import { ROOT_DIR, resolveFromRoot } from "./paths.ts";

export type MetadataSyncOptions = {
	scope: "all" | "rust" | "npm";
};

export function runMetadataSync(options: MetadataSyncOptions): void {
	const metadata = loadSecuritydeptMetadata();
	let rustManifestCount = 0;
	let rustReadmeCount = 0;
	let npmManifestCount = 0;
	let npmReadmeCount = 0;

	if (options.scope === "all" || options.scope === "rust") {
		for (const pkg of metadata.rustPackages.filter((pkg) => pkg.publish)) {
			const result = syncRustPackageMetadata(pkg);
			rustManifestCount += result.manifestUpdated ? 1 : 0;
			rustReadmeCount += result.readmeUpdated ? 1 : 0;
		}
	}

	if (options.scope === "all" || options.scope === "npm") {
		for (const pkg of metadata.nodePackages.filter((pkg) => pkg.publish)) {
			const result = syncNodePackageMetadata(pkg);
			npmManifestCount += result.manifestUpdated ? 1 : 0;
			npmReadmeCount += result.readmeUpdated ? 1 : 0;
		}
	}

	console.log(
		`Metadata sync completed. Rust manifests: ${rustManifestCount}, Rust READMEs: ${rustReadmeCount}, npm manifests: ${npmManifestCount}, npm READMEs: ${npmReadmeCount}.`,
	);

	function syncRustPackageMetadata(pkg: RustPackageMetadata): {
		manifestUpdated: boolean;
		readmeUpdated: boolean;
	} {
		const manifestPath = resolveFromRoot(pkg.manifest);
		const packageDir = path.dirname(manifestPath);
		const description = `${formatRustDisplayName(pkg.name)} of ${metadata.project.displayName}, ${metadata.rust.descriptionBase}.`;
		const updatedManifestSource = upsertCargoPackageFields(
			readFileSync(manifestPath, "utf8"),
			{
				authors: [metadata.project.author],
				description,
				license: metadata.project.license,
				repository: metadata.project.repositoryUrl,
				homepage: metadata.project.homepageUrl,
				documentation: `${metadata.rust.documentationUrlBase}/${pkg.name}`,
				readme: "README.md",
				keywords: metadata.rust.keywords,
			},
		);
		const manifestUpdated = writeIfChanged(manifestPath, updatedManifestSource);
		const readmeUpdated = syncReadme(
			path.join(packageDir, "README.md"),
			createPackageReadme(
				pkg.name,
				description,
				metadata.project.repositoryUrl,
			),
		);

		return { manifestUpdated, readmeUpdated };
	}

	function syncNodePackageMetadata(pkg: NodePackageMetadata): {
		manifestUpdated: boolean;
		readmeUpdated: boolean;
	} {
		const manifestPath = resolveFromRoot(pkg.manifest);
		const packageDir = path.dirname(manifestPath);
		const relativePackageDir = toPosixPath(path.relative(ROOT_DIR, packageDir));
		const description = `${formatNodeDisplayName(pkg.name)} of ${metadata.npm.descriptionBase}.`;
		const source = readFileSync(manifestPath, "utf8");
		const parsed = JSON.parse(source) as Record<string, unknown>;
		const existingName = parsed.name;
		const existingVersion = parsed.version;

		const updatedPackage = {
			...parsed,
			name: existingName,
			version: existingVersion,
			description,
			author: metadata.project.author,
			license: metadata.project.license,
			repository: {
				type: "git",
				url: metadata.project.repositoryGitUrl,
				directory: relativePackageDir,
			},
			homepage: metadata.project.homepageUrl,
			bugs: {
				url: metadata.project.issuesUrl,
			},
			keywords: metadata.npm.keywords,
		};
		const nextSource = `${JSON.stringify(updatedPackage, null, "\t")}\n`;
		const manifestUpdated = writeIfChanged(manifestPath, nextSource);
		const readmeUpdated = syncReadme(
			path.join(packageDir, "README.md"),
			createPackageReadme(
				pkg.name,
				description,
				metadata.project.repositoryUrl,
			),
		);

		return { manifestUpdated, readmeUpdated };
	}
}

function upsertCargoPackageFields(
	source: string,
	fields: Record<string, string | string[]>,
): string {
	const eol = source.includes("\r\n") ? "\r\n" : "\n";
	const lines = source.split(/\r?\n/u);
	let packageStartIndex = -1;
	let packageEndIndex = lines.length;

	for (let index = 0; index < lines.length; index += 1) {
		const trimmed = lines[index].trim();
		if (trimmed === "[package]") {
			packageStartIndex = index;
			continue;
		}
		if (
			packageStartIndex !== -1 &&
			trimmed.startsWith("[") &&
			trimmed.endsWith("]")
		) {
			packageEndIndex = index;
			break;
		}
	}

	if (packageStartIndex === -1) {
		throw new Error("Cargo.toml is missing a [package] section.");
	}

	const nextLines = [...lines];
	const missingEntries: Array<[string, string | string[]]> = [];

	for (const [key, value] of Object.entries(fields)) {
		const lineIndex = findCargoPackageFieldLineIndex(
			nextLines,
			packageStartIndex,
			packageEndIndex,
			key,
		);
		const nextLine = `${key} = ${serializeCargoTomlValue(value)}`;
		if (lineIndex === -1) {
			missingEntries.push([key, value]);
			continue;
		}
		nextLines[lineIndex] = nextLine;
	}

	if (missingEntries.length > 0) {
		const insertionIndex = packageEndIndex;
		const insertionLines = missingEntries.map(
			([key, value]) => `${key} = ${serializeCargoTomlValue(value)}`,
		);
		nextLines.splice(insertionIndex, 0, ...insertionLines);
	}

	return nextLines.join(eol);
}

function findCargoPackageFieldLineIndex(
	lines: string[],
	packageStartIndex: number,
	packageEndIndex: number,
	key: string,
): number {
	for (let index = packageStartIndex + 1; index < packageEndIndex; index += 1) {
		const trimmed = lines[index].trim();
		if (trimmed.startsWith(`${key} = `)) {
			return index;
		}
	}

	return -1;
}

function serializeCargoTomlValue(value: string | string[]): string {
	if (Array.isArray(value)) {
		return JSON.stringify(value);
	}

	return JSON.stringify(value);
}

function createPackageReadme(
	packageName: string,
	description: string,
	repositoryUrl: string,
): string {
	return `# ${packageName}\n\n${description}\n\nRepository: [ethaxon/securitydept](${repositoryUrl})\n`;
}

function syncReadme(readmePath: string, content: string): boolean {
	return writeIfChanged(readmePath, content);
}

function writeIfChanged(filePath: string, nextSource: string): boolean {
	let currentSource: string | null = null;
	try {
		currentSource = readFileSync(filePath, "utf8");
	} catch {
		currentSource = null;
	}

	if (currentSource === nextSource) {
		return false;
	}

	writeFileSync(filePath, nextSource);
	return true;
}

function formatRustDisplayName(crateName: string): string {
	return formatDisplayName(crateName.replace(/^securitydept-/u, ""));
}

function formatNodeDisplayName(packageName: string): string {
	return formatDisplayName(packageName.replace(/^@securitydept\//u, ""));
}

function formatDisplayName(slug: string): string {
	const tokenMap: Record<string, string> = {
		angular: "Angular",
		auth: "Auth",
		basic: "Basic",
		cli: "CLI",
		client: "Client",
		context: "Context",
		core: "Core",
		creds: "Credentials",
		docs: "Docs",
		manage: "Management",
		npm: "npm",
		oauth: "OAuth",
		oidc: "OIDC",
		provider: "Provider",
		react: "React",
		realip: "Real IP",
		resource: "Resource",
		server: "Server",
		session: "Session",
		set: "Set",
		site: "Site",
		test: "Test",
		token: "Token",
		utils: "Utils",
		webui: "WebUI",
	};

	return slug
		.split("-")
		.map((segment) => tokenMap[segment] ?? capitalize(segment))
		.join(" ");
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function toPosixPath(value: string): string {
	return value.split(path.sep).join("/");
}
