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
				find: "@securitydept/client",
				replacement: path.join(packagesDir, "client/src/index.ts"),
			},
			{
				find: "@securitydept/basic-auth-context-client/react",
				replacement: path.join(
					packagesDir,
					"basic-auth-context-client/src/react/index.tsx",
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
				find: "@securitydept/basic-auth-context-client",
				replacement: path.join(
					packagesDir,
					"basic-auth-context-client/src/index.ts",
				),
			},
			{
				find: "@securitydept/session-context-client/react",
				replacement: path.join(
					packagesDir,
					"session-context-client/src/react/index.tsx",
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
				find: "@securitydept/token-set-context-client/web",
				replacement: path.join(
					packagesDir,
					"token-set-context-client/src/web/index.ts",
				),
			},
			{
				find: "@securitydept/token-set-context-client/react",
				replacement: path.join(
					packagesDir,
					"token-set-context-client/src/react/index.tsx",
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
				find: "@securitydept/token-set-context-client/oidc",
				replacement: path.join(
					packagesDir,
					"token-set-context-client/src/oidc/index.ts",
				),
			},
			{
				find: "@securitydept/token-set-context-client/token-set/web",
				replacement: path.join(
					packagesDir,
					"token-set-context-client/src/token-set/web/index.ts",
				),
			},
			{
				find: "@securitydept/token-set-context-client/token-set/react",
				replacement: path.join(
					packagesDir,
					"token-set-context-client/src/token-set/react/index.tsx",
				),
			},
			{
				find: "@securitydept/token-set-context-client/token-set",
				replacement: path.join(
					packagesDir,
					"token-set-context-client/src/token-set/index.ts",
				),
			},
			{
				find: "@securitydept/token-set-context-client",
				replacement: path.join(
					packagesDir,
					"token-set-context-client/src/index.ts",
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
			"examples/**/*.test.ts",
		],
	},
});
