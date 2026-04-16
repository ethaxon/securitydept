import path from "node:path";
import { defineConfig } from "vitest/config";

// Explicit aliases so vitest resolves internal workspace packages
// directly from source, regardless of whether `dist/` has been built.
const packagesDir = path.resolve(import.meta.dirname, "packages");

export default defineConfig({
	resolve: {
		alias: [
			{
				find: "@securitydept/client/web",
				replacement: path.join(packagesDir, "client/src/web/index.ts"),
			},
			{
				find: "@securitydept/client/persistence/web",
				replacement: path.join(
					packagesDir,
					"client/src/persistence/web/index.ts",
				),
			},
			{
				find: "@securitydept/client/persistence",
				replacement: path.join(packagesDir, "client/src/persistence/index.ts"),
			},
			{
				find: "@securitydept/client/auth-coordination",
				replacement: path.join(
					packagesDir,
					"client/src/auth-coordination/index.ts",
				),
			},
			{
				find: "@securitydept/client/web-router",
				replacement: path.join(packagesDir, "client/src/web-router/index.ts"),
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
				find: "@securitydept/basic-auth-context-client/web",
				replacement: path.join(
					packagesDir,
					"basic-auth-context-client/src/web/index.ts",
				),
			},
			{
				find: "@securitydept/basic-auth-context-client/server",
				replacement: path.join(
					packagesDir,
					"basic-auth-context-client/src/server/index.ts",
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
				find: "@securitydept/session-context-client/web",
				replacement: path.join(
					packagesDir,
					"session-context-client/src/web/index.ts",
				),
			},
			{
				find: "@securitydept/session-context-client/server",
				replacement: path.join(
					packagesDir,
					"session-context-client/src/server/index.ts",
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
				// client-react root export — planner-host React Context integration
				find: "@securitydept/client-react",
				replacement: path.join(
					packagesDir,
					"client-react/src/planner-host/index.tsx",
				),
			},
			{
				// token-set-context-client-react react-query subpath — MUST precede root alias
				find: "@securitydept/token-set-context-client-react/react-query",
				replacement: path.join(
					packagesDir,
					"token-set-context-client-react/src/react-query/index.ts",
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
				find: "@securitydept/token-set-context-client/backend-oidc-mode/web",
				replacement: path.join(
					packagesDir,
					"token-set-context-client/src/backend-oidc-mode/web/index.ts",
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
		// Load @angular/compiler JIT so partial-compiled ng-packagr output works.
		setupFiles: ["./vitest.angular-setup.ts"],
	},
});
