/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface PackageContract {
	dir: string;
	name: string;
	exportKeys: string[];
	reactAdapter: boolean;
	experimental: boolean;
}

interface PackageJsonContract {
	name?: string;
	sideEffects?: boolean;
	exports?: Record<string, unknown>;
	peerDependencies?: {
		react?: string;
	};
	peerDependenciesMeta?: {
		react?: {
			optional?: boolean;
		};
	};
}

const CONTRACTS: PackageContract[] = [
	{
		dir: "client",
		name: "@securitydept/client",
		exportKeys: [".", "./persistence", "./persistence/web", "./web"],
		reactAdapter: false,
		experimental: false,
	},
	{
		dir: "basic-auth-context-client",
		name: "@securitydept/basic-auth-context-client",
		exportKeys: [".", "./react", "./web"],
		reactAdapter: true,
		experimental: false,
	},
	{
		dir: "session-context-client",
		name: "@securitydept/session-context-client",
		exportKeys: [".", "./react"],
		reactAdapter: true,
		experimental: false,
	},
	{
		dir: "token-set-context-client",
		name: "@securitydept/token-set-context-client",
		exportKeys: [
			"./backend-oidc-mode",
			"./backend-oidc-mode/web",
			"./backend-oidc-mode/react",
			"./frontend-oidc-mode",
			"./orchestration",
			"./access-token-substrate",
		],
		reactAdapter: true,
		experimental: false,
	},
	{
		dir: "test-utils",
		name: "@securitydept/test-utils",
		exportKeys: ["."],
		reactAdapter: false,
		experimental: true,
	},
];

const tsWorkspaceRoot = path.resolve(import.meta.dirname, "../../../../../");
const packagesRoot = path.join(tsWorkspaceRoot, "packages");

describe("workspace package contract", () => {
	it("keeps package export maps aligned with the intended public contract", () => {
		for (const contract of CONTRACTS) {
			const packageRoot = path.join(packagesRoot, contract.dir);
			const packageJson = readJson(path.join(packageRoot, "package.json"));
			const tsdownConfig = fs.readFileSync(
				path.join(packageRoot, "tsdown.config.ts"),
				"utf8",
			);
			const exportMap = packageJson.exports ?? {};

			expect(packageJson.name).toBe(contract.name);
			expect(packageJson.sideEffects).toBe(false);
			expect(Object.keys(exportMap)).toEqual(contract.exportKeys);

			for (const exportKey of contract.exportKeys) {
				const entryKey = mapExportKeyToEntryKey(exportKey);
				expect(
					tsdownConfig.includes(`"${entryKey}":`) ||
						tsdownConfig.includes(`${entryKey}:`),
				).toBe(true);
			}

			if (contract.reactAdapter) {
				expect(packageJson.peerDependencies?.react).toBeDefined();
				expect(packageJson.peerDependenciesMeta?.react?.optional).toBe(true);
				const hasReactExport = Object.keys(exportMap).some((k) =>
					k.endsWith("/react"),
				);
				expect(hasReactExport).toBe(true);
			} else {
				expect(packageJson.peerDependencies?.react).toBeUndefined();
			}

			if (contract.experimental) {
				expect(contract.exportKeys).toEqual(["."]);
			}
		}
	});

	it("does not allow compiled artifacts to live under package src directories", () => {
		const leakedArtifacts = collectCompiledArtifacts(path.join(packagesRoot));
		expect(leakedArtifacts).toEqual([]);
	});
});

function readJson(filePath: string): PackageJsonContract {
	return JSON.parse(fs.readFileSync(filePath, "utf8")) as PackageJsonContract;
}

function mapExportKeyToEntryKey(exportKey: string): string {
	if (exportKey === ".") {
		return "index";
	}

	return `${exportKey.slice(2)}/index`;
}

function collectCompiledArtifacts(packagesDir: string): string[] {
	const leaked: string[] = [];

	for (const packageDir of fs.readdirSync(packagesDir)) {
		const srcDir = path.join(packagesDir, packageDir, "src");
		if (!fs.existsSync(srcDir)) {
			continue;
		}

		visitSrc(srcDir, leaked, packagesDir);
	}

	return leaked.sort();
}

function visitSrc(
	currentDir: string,
	leaked: string[],
	packagesDir: string,
): void {
	for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
		const entryPath = path.join(currentDir, entry.name);
		if (entry.isDirectory()) {
			visitSrc(entryPath, leaked, packagesDir);
			continue;
		}

		if (/\.(?:js|js\.map|d\.ts|d\.ts\.map)$/.test(entry.name)) {
			leaked.push(path.relative(packagesDir, entryPath));
		}
	}
}
