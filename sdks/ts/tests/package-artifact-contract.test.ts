/// <reference types="node" />

import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(workspaceRoot, "../..");

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

	it("preserves registry runtime values and event types through dist declarations", () => {
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
});
