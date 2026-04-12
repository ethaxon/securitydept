import path from "node:path";
import { defineConfig } from "vitest/config";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const packagesDir = path.join(repoRoot, "sdks/ts/packages");

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
				find: "@securitydept/session-context-client",
				replacement: path.join(
					packagesDir,
					"session-context-client/src/index.ts",
				),
			},
			{
				find: "@securitydept/token-set-context-client/backend-oidc-mode/web",
				replacement: path.join(
					packagesDir,
					"token-set-context-client/src/web/index.ts",
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
			{
				find: /^@\//,
				replacement: `${path.join(import.meta.dirname, "src")}/`,
			},
		],
	},
	test: {
		include: [
			"src/**/__tests__/**/*.test.ts",
			"src/**/__tests__/**/*.test.tsx",
		],
	},
});
