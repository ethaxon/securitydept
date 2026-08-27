/// <reference types="node" />

import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { type DtsOptions } from "tsdown";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(workspaceRoot, "../..");

async function importTokenSetTestRuntimeArtifact(
	artifactUrl: string,
): Promise<typeof import("@securitydept/token-set-context-client/test")> {
	return import(/* @vite-ignore */ artifactUrl);
}

describe("package artifact contracts", () => {
	it("imports the client root artifact when mnemonist is unavailable", () => {
		const clientEntryUrl = pathToFileURL(
			path.join(workspaceRoot, "packages/client/dist/index.mjs"),
		).href;
		const script = `
			import { registerHooks } from "node:module";
			registerHooks({
				resolve(specifier, context, nextResolve) {
					if (specifier === "mnemonist" || specifier.startsWith("mnemonist/")) {
						throw new Error("mnemonist must not be required by @securitydept/client");
					}
					return nextResolve(specifier, context);
				},
			});
			await import(${JSON.stringify(clientEntryUrl)});
		`;

		expect(() =>
			execFileSync(
				process.execPath,
				["--input-type=module", "--eval", script],
				{
					cwd: repositoryRoot,
					stdio: "pipe",
				},
			),
		).not.toThrow();
	});

	it("preserves registry tokens, adapters, runtime values and event types through dist declarations", () => {
		const fixture = path.join(
			import.meta.dirname,
			"fixtures/registry-artifact-consumer.ts",
		);
		const compilerOptions: ts.CompilerOptions = {
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			noEmit: true,
			skipLibCheck: true,
			strict: true,
			target: ts.ScriptTarget.ES2022,
		};
		const resolvedRegistry = ts.resolveModuleName(
			"@securitydept/token-set-context-client/registry",
			fixture,
			compilerOptions,
			ts.sys,
		).resolvedModule;
		expect(resolvedRegistry?.resolvedFileName).toContain("/dist/registry/");
		const resolvedTest = ts.resolveModuleName(
			"@securitydept/token-set-context-client/test",
			fixture,
			compilerOptions,
			ts.sys,
		).resolvedModule;
		expect(resolvedTest?.resolvedFileName).toContain("/dist/test/");
		for (const adapter of [
			"@securitydept/token-set-context-client-angular",
			"@securitydept/token-set-context-client-react",
		]) {
			const resolvedAdapter = ts.resolveModuleName(
				adapter,
				fixture,
				compilerOptions,
				ts.sys,
			).resolvedModule;
			expect(resolvedAdapter?.resolvedFileName).toContain("/dist/");
		}

		const program = ts.createProgram([fixture], compilerOptions);
		const diagnostics = ts.getPreEmitDiagnostics(program);
		expect(
			ts.formatDiagnosticsWithColorAndContext(diagnostics, {
				getCanonicalFileName: (fileName) => fileName,
				getCurrentDirectory: () => repositoryRoot,
				getNewLine: () => "\n",
			}),
		).toBe("");
	});

	it("emits typed registry tokens without any dist-tsc outputs", async () => {
		const declarationOptionsUrl = pathToFileURL(
			path.join(repositoryRoot, "scripts/tooling/sdk-declarations.ts"),
		).href;
		const { SDK_DECLARATION_OPTIONS }: { SDK_DECLARATION_OPTIONS: DtsOptions } =
			await import(/* @vite-ignore */ declarationOptionsUrl);
		const configPath = path.join(
			workspaceRoot,
			"packages/token-set-context-client/tsconfig.json",
		);
		const config = ts.readConfigFile(configPath, ts.sys.readFile);
		expect(config.error).toBeUndefined();
		const parsedConfig = ts.parseJsonConfigFileContent(
			{
				...config.config,
				...SDK_DECLARATION_OPTIONS.tsconfigRaw,
				compilerOptions: {
					...config.config.compilerOptions,
					...SDK_DECLARATION_OPTIONS.compilerOptions,
				},
			},
			ts.sys,
			path.dirname(configPath),
		);
		expect(parsedConfig.errors).toEqual([]);
		expect(parsedConfig.projectReferences).toBeUndefined();
		const host = ts.createCompilerHost(parsedConfig.options);
		const readFile = host.readFile.bind(host);
		const fileExists = host.fileExists.bind(host);
		host.readFile = (file) =>
			file.includes("/dist-tsc/") ? undefined : readFile(file);
		host.fileExists = (file) =>
			!file.includes("/dist-tsc/") && fileExists(file);
		const program = ts.createProgram({
			rootNames: parsedConfig.fileNames,
			options: parsedConfig.options,
			projectReferences: parsedConfig.projectReferences,
			host,
		});
		const source = program.getSourceFile(
			path.join(
				workspaceRoot,
				"packages/token-set-context-client/src/registry/contracts/tokens.ts",
			),
		);
		expect(source).toBeDefined();
		expect(ts.getPreEmitDiagnostics(program)).toEqual([]);
		let declaration = "";
		const result = program.emit(
			source,
			(file, text) => {
				if (file.endsWith(".d.ts")) {
					declaration = text;
				}
			},
			undefined,
			true,
		);
		expect(result.emitSkipped).toBe(false);
		expect(declaration).toContain(
			"TOKEN_SET_CLIENT_REGISTRY: SecuritydeptInjectionToken<TokenSetClientRegistry<BaseOidcModeClient>>",
		);
		expect(declaration).toContain(
			"TOKEN_SET_CLIENT_REGISTRY_ENTRIES: SecuritydeptInjectionToken<readonly TokenSetClientRegistryEntry<BaseOidcModeClient>[]>",
		);
	});

	it("imports and instantiates the token-set test runtime artifact", async () => {
		const testEntryUrl = pathToFileURL(
			path.join(
				workspaceRoot,
				"packages/token-set-context-client/dist/test/index.mjs",
			),
		).href;
		const {
			createTokenSetClientForTest,
			createTokenSetClientRegistryEntryForTest,
			createTokenSetClientRegistryForTest,
		} = await importTokenSetTestRuntimeArtifact(testEntryUrl);
		const client = createTokenSetClientForTest();
		const entry = createTokenSetClientRegistryEntryForTest({
			clientKey: "artifact-client",
			client,
		});
		using registry = createTokenSetClientRegistryForTest({ entries: [entry] });

		await registry.clientRecordFor("artifact-client", { initialize: true });
	});
});
