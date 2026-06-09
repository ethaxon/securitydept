import path from "node:path";
import { defineConfig } from "tsdown";
import { runTurboPrerequisites } from "../../../../scripts/tooling/turbo-prerequisites.ts";

export default defineConfig({
	entry: {
		// Root export — injector and page environment helpers.
		index: "./src/index.ts",
		// TanStack React Router route adapter for auth-coordination.
		"tanstack-router/index": "./src/tanstack-router/index.ts",
	},
	hooks: {
		"build:prepare": () =>
			runTurboPrerequisites({
				workspaceRoot: path.resolve(import.meta.dirname, "../../../.."),
				packageRoot: import.meta.dirname,
				includeSelf: false,
			}),
	},
	target: "es2022",
	format: "esm",
	dts: true,
	sourcemap: true,
	clean: true,
	deps: {
		neverBundle: ["react", "@tanstack/react-router"],
	},
	outDir: "./dist",
});
