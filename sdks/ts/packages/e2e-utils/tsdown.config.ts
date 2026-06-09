import path from "node:path";
import { defineConfig } from "tsdown";
import { runTurboPrerequisites } from "../../../../scripts/tooling/turbo-prerequisites.ts";

export default defineConfig({
	entry: { index: "./src/index.ts" },
	hooks: {
		"build:prepare": () =>
			runTurboPrerequisites({
				workspaceRoot: path.resolve(import.meta.dirname, "../../../.."),
				packageRoot: import.meta.dirname,
				includeSelf: false,
			}),
	},
	format: "esm",
	dts: true,
	sourcemap: true,
	clean: true,
	outDir: "./dist",
});
