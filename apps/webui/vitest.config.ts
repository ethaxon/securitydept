import path from "node:path";
import { defineConfig } from "vitest/config";
import { createStage3DecoratorSwcPlugin } from "../../scripts/ts/stage3-decorator-swc.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const packagesDir = path.join(repoRoot, "sdks/ts/packages");
const stage3DecoratorRoots = [
	path.join(packagesDir, "client"),
	path.join(packagesDir, "basic-auth-context-client"),
	path.join(packagesDir, "session-context-client"),
	path.join(packagesDir, "token-set-context-client"),
];

export default defineConfig({
	plugins: [createStage3DecoratorSwcPlugin({ roots: stage3DecoratorRoots })],
	resolve: {
		alias: [
			{
				find: "@securitydept/client/web",
				replacement: path.join(packagesDir, "client/src/web/index.ts"),
			},
			{
				find: "@securitydept/client/test",
				replacement: path.join(packagesDir, "client/src/test/index.ts"),
			},
			{
				find: "@securitydept/client/rx",
				replacement: path.join(packagesDir, "client/src/rx/index.ts"),
			},
			{
				find: /^@securitydept\/client$/,
				replacement: path.join(packagesDir, "client/src/index.ts"),
			},
			{
				find: "@securitydept/client-react/tanstack-router",
				replacement: path.join(
					packagesDir,
					"client-react/src/tanstack-router/index.ts",
				),
			},
			{
				find: "@securitydept/client-react",
				replacement: path.join(packagesDir, "client-react/src/index.ts"),
			},
			{
				find: "@securitydept/session-context-client",
				replacement: path.join(
					packagesDir,
					"session-context-client/src/index.ts",
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
				find: "@securitydept/basic-auth-context-client-react",
				replacement: path.join(
					packagesDir,
					"basic-auth-context-client-react/src/index.tsx",
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
				find: "@securitydept/token-set-context-client/frontend-oidc-mode",
				replacement: path.join(
					packagesDir,
					"token-set-context-client/src/frontend-oidc-mode/index.ts",
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
				find: "@securitydept/token-set-context-client-react/tanstack-router",
				replacement: path.join(
					packagesDir,
					"token-set-context-client-react/src/tanstack-router/index.ts",
				),
			},
			{
				find: "@securitydept/token-set-context-client-react",
				replacement: path.join(
					packagesDir,
					"token-set-context-client-react/src/index.tsx",
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
