import path from "node:path";
import ts from "typescript";
import { defineConfig } from "vitest/config";

// Explicit aliases so vitest resolves internal workspace packages
// directly from source, regardless of whether `dist/` has been built.
const packagesDir = path.resolve(import.meta.dirname, "packages");
const ciTestTimeoutMs = 15_000;
const isCi = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const stage3DecoratorRoots = [
	path.join(packagesDir, "client"),
	path.join(packagesDir, "basic-auth-context-client"),
	path.join(packagesDir, "session-context-client"),
	path.join(packagesDir, "token-set-context-client"),
];

function createStage3DecoratorTransformPlugin() {
	return {
		name: "securitydept-stage3-decorators",
		enforce: "pre" as const,
		transform(code: string, id: string) {
			const filePath = id.split("?", 1)[0];
			if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) {
				return null;
			}
			if (!stage3DecoratorRoots.some((root) => filePath.startsWith(root))) {
				return null;
			}
			if (!/@[A-Za-z_$]/.test(code)) {
				return null;
			}
			const result = ts.transpileModule(code, {
				fileName: filePath,
				compilerOptions: {
					target: ts.ScriptTarget.ES2022,
					module: ts.ModuleKind.ESNext,
					moduleResolution: ts.ModuleResolutionKind.Bundler,
					jsx: filePath.endsWith(".tsx")
						? ts.JsxEmit.ReactJSX
						: ts.JsxEmit.Preserve,
					experimentalDecorators: false,
					useDefineForClassFields: true,
					sourceMap: true,
				},
			});
			return {
				code: result.outputText,
				map: result.sourceMapText ? JSON.parse(result.sourceMapText) : null,
			};
		},
	};
}

export default defineConfig({
	plugins: [createStage3DecoratorTransformPlugin()],
	resolve: {
		alias: [
			{
				find: "@securitydept/client/server",
				replacement: path.join(packagesDir, "client/src/server/index.ts"),
			},
			{
				find: "@securitydept/client/web",
				replacement: path.join(packagesDir, "client/src/web/index.ts"),
			},
			{
				find: "@securitydept/client/rx",
				replacement: path.join(packagesDir, "client/src/rx/index.ts"),
			},
			{
				find: "@securitydept/client/test",
				replacement: path.join(packagesDir, "client/src/test/index.ts"),
			},
			{
				find: "@securitydept/client",
				replacement: path.join(packagesDir, "client/src/index.ts"),
			},
			{
				find: "@securitydept/basic-auth-context-client-react",
				replacement: path.join(
					packagesDir,
					"basic-auth-context-client-react/src/index.tsx",
				),
			},
			{
				// Angular packages use ng-packagr output (vitest can't parse decorators)
				find: "@securitydept/basic-auth-context-client-angular",
				replacement: path.join(
					packagesDir,
					"basic-auth-context-client-angular/dist/fesm2022/securitydept-basic-auth-context-client-angular.mjs",
				),
			},
			{
				find: "@securitydept/basic-auth-context-client",
				replacement: path.join(
					packagesDir,
					"basic-auth-context-client/src/index.ts",
				),
			},
			{
				find: "@securitydept/session-context-client-react",
				replacement: path.join(
					packagesDir,
					"session-context-client-react/src/index.tsx",
				),
			},
			{
				find: "@securitydept/session-context-client-angular",
				replacement: path.join(
					packagesDir,
					"session-context-client-angular/dist/fesm2022/securitydept-session-context-client-angular.mjs",
				),
			},
			{
				find: "@securitydept/session-context-client",
				replacement: path.join(
					packagesDir,
					"session-context-client/src/index.ts",
				),
			},
			{
				// client-react tanstack-router subpath — MUST precede root alias
				find: "@securitydept/client-react/tanstack-router",
				replacement: path.join(
					packagesDir,
					"client-react/src/tanstack-router/index.ts",
				),
			},
			{
				// client-react root export — planner-host plus environment-service React Context integration
				find: "@securitydept/client-react",
				replacement: path.join(packagesDir, "client-react/src/index.ts"),
			},
			{
				// token-set-context-client-react tanstack-router subpath — MUST precede root alias
				find: "@securitydept/token-set-context-client-react/tanstack-router",
				replacement: path.join(
					packagesDir,
					"token-set-context-client-react/src/tanstack-router/index.ts",
				),
			},
			{
				// token-set-context-client-react root (BackendOidc React context/hooks)
				find: "@securitydept/token-set-context-client-react",
				replacement: path.join(
					packagesDir,
					"token-set-context-client-react/src/index.tsx",
				),
			},
			{
				// client-angular — shared Angular route adapter; requires prior ng-packagr build.
				// Points to FESM output to avoid Angular decorator parse issues in vitest.
				find: "@securitydept/client-angular",
				replacement: path.join(
					packagesDir,
					"client-angular/dist/fesm2022/securitydept-client-angular.mjs",
				),
			},
			{
				find: "@securitydept/token-set-context-client-angular",
				replacement: path.join(
					packagesDir,
					"token-set-context-client-angular/dist/fesm2022/securitydept-token-set-context-client-angular.mjs",
				),
			},
			{
				find: "@securitydept/token-set-context-client/registry",
				replacement: path.join(
					packagesDir,
					"token-set-context-client/src/registry/index.ts",
				),
			},
			{
				find: "@securitydept/token-set-context-client/orchestration",
				replacement: path.join(
					packagesDir,
					"token-set-context-client/src/orchestration/index.ts",
				),
			},
			{
				find: "@securitydept/token-set-context-client/access-token-substrate",
				replacement: path.join(
					packagesDir,
					"token-set-context-client/src/access-token-substrate/index.ts",
				),
			},
			{
				find: "@securitydept/token-set-context-client/frontend-oidc-mode",
				replacement: path.join(
					packagesDir,
					"token-set-context-client/src/frontend-oidc-mode/index.ts",
				),
			},
			{
				find: "@securitydept/token-set-context-client/backend-oidc-mode",
				replacement: path.join(
					packagesDir,
					"token-set-context-client/src/backend-oidc-mode/index.ts",
				),
			},
			{
				find: "@securitydept/test-utils",
				replacement: path.join(packagesDir, "test-utils/src/index.ts"),
			},
		],
	},
	test: {
		include: [
			"packages/*/src/**/__tests__/**/*.test.ts",
			"packages/*/src/**/__tests__/**/*.test.tsx",
			"examples/**/*.test.ts",
		],
		testTimeout: isCi ? ciTestTimeoutMs : undefined,
		// Load @angular/compiler JIT so partial-compiled ng-packagr output works.
		setupFiles: ["./vitest.angular-setup.ts"],
	},
});
