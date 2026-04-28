/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface PackageContract {
	dir: string;
	name: string;
	exportKeys: string[];
	/** True if the package has `react` in peerDependencies (optional or not). */
	hasReactPeer: boolean;
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
		exportKeys: [
			".",
			"./persistence",
			"./persistence/web",
			"./web",
			"./events",
			"./auth-coordination",
			"./web-router",
		],
		hasReactPeer: false,
		experimental: false,
	},
	{
		dir: "basic-auth-context-client",
		name: "@securitydept/basic-auth-context-client",
		exportKeys: [".", "./web", "./server"],
		hasReactPeer: false,
		experimental: false,
	},
	{
		dir: "basic-auth-context-client-react",
		name: "@securitydept/basic-auth-context-client-react",
		exportKeys: ["."],
		hasReactPeer: true,
		experimental: false,
	},
	{
		dir: "session-context-client",
		name: "@securitydept/session-context-client",
		exportKeys: [".", "./web", "./server"],
		hasReactPeer: false,
		experimental: false,
	},
	{
		dir: "session-context-client-react",
		name: "@securitydept/session-context-client-react",
		exportKeys: ["."],
		hasReactPeer: true,
		experimental: false,
	},
	{
		dir: "token-set-context-client",
		name: "@securitydept/token-set-context-client",
		exportKeys: [
			"./backend-oidc-mode",
			"./backend-oidc-mode/web",
			"./frontend-oidc-mode",
			"./orchestration",
			"./access-token-substrate",
			"./registry",
			"./web-router",
		],
		hasReactPeer: false,
		experimental: false,
	},
	{
		dir: "token-set-context-client-react",
		name: "@securitydept/token-set-context-client-react",
		exportKeys: [".", "./react-query", "./tanstack-router"],
		hasReactPeer: true,
		experimental: false,
	},
	{
		dir: "client-react",
		name: "@securitydept/client-react",
		exportKeys: [".", "./tanstack-router"],
		hasReactPeer: true,
		experimental: false,
	},
	{
		dir: "test-utils",
		name: "@securitydept/test-utils",
		exportKeys: ["."],
		hasReactPeer: false,
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

			if (contract.hasReactPeer) {
				expect(packageJson.peerDependencies?.react).toBeDefined();
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

/** Contract for ng-packagr–based Angular adapter packages. */
interface AngularPackageContract {
	dir: string;
	name: string;
	/** Whether the package provides an Angular router adapter. */
	hasRouterAdapter: boolean;
}

const ANGULAR_CONTRACTS: AngularPackageContract[] = [
	{
		dir: "basic-auth-context-client-angular",
		name: "@securitydept/basic-auth-context-client-angular",
		hasRouterAdapter: false,
	},
	{
		dir: "session-context-client-angular",
		name: "@securitydept/session-context-client-angular",
		hasRouterAdapter: false,
	},
	{
		dir: "token-set-context-client-angular",
		name: "@securitydept/token-set-context-client-angular",
		hasRouterAdapter: true,
	},
	{
		dir: "client-angular",
		name: "@securitydept/client-angular",
		hasRouterAdapter: true,
	},
];

describe("Angular workspace package contract", () => {
	it("keeps Angular adapter packages well-formed (ng-packagr layout)", () => {
		for (const contract of ANGULAR_CONTRACTS) {
			const packageRoot = path.join(packagesRoot, contract.dir);

			// Must have ng-package.json
			const ngPackageJson = readJson(
				path.join(packageRoot, "ng-package.json"),
			) as {
				dest?: string;
				lib?: { entryFile?: string };
			};
			expect(ngPackageJson.dest).toBeDefined();
			expect(ngPackageJson.lib?.entryFile).toBe("./src/public-api.ts");

			// package.json basics
			const packageJson = readJson(path.join(packageRoot, "package.json"));
			expect(packageJson.name).toBe(contract.name);
			expect(packageJson.sideEffects).toBe(false);

			// Must peer-depend on @angular/core
			const peerDeps = (packageJson as Record<string, unknown>)
				.peerDependencies as Record<string, string> | undefined;
			expect(peerDeps?.["@angular/core"]).toBeDefined();

			// Router adapter packages must additionally peer-depend on @angular/router
			if (contract.hasRouterAdapter) {
				expect(peerDeps?.["@angular/router"]).toBeDefined();
			}

			// dist/ must exist (has been built)
			expect(fs.existsSync(path.join(packageRoot, "dist"))).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// Build topology guardrails
// ---------------------------------------------------------------------------

describe("Angular workspace build topology guardrails", () => {
	it("*-angular packages mirror workspace:* peer deps in devDependencies", () => {
		for (const contract of ANGULAR_CONTRACTS) {
			const packageRoot = path.join(packagesRoot, contract.dir);
			const packageJson = readJson(`${packageRoot}/package.json`) as Record<
				string,
				unknown
			>;
			const peerDeps = (packageJson.peerDependencies ?? {}) as Record<
				string,
				string
			>;
			const devDeps = (packageJson.devDependencies ?? {}) as Record<
				string,
				string
			>;

			// Every workspace:* peerDependency must also be in devDependencies
			for (const [dep, version] of Object.entries(peerDeps)) {
				if (version === "workspace:*") {
					expect(
						devDeps[dep],
						`${contract.name}: workspace:* peer dep "${dep}" must also be in devDependencies`,
					).toBe("workspace:*");
				}
			}
		}
	});

	it("root build script uses pnpm recursive build (not manual core/angular split)", () => {
		const rootPkg = readJson(
			path.join(tsWorkspaceRoot, "package.json"),
		) as Record<string, unknown>;
		const scripts = (rootPkg.scripts ?? {}) as Record<string, string>;
		const buildScript = scripts.build ?? "";

		// Must NOT contain the old manual two-phase pattern
		expect(buildScript).not.toContain("build:core");
		expect(buildScript).not.toContain("build:angular");

		// Must use pnpm recursive
		expect(buildScript).toContain("pnpm -r");
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
