import path from "node:path";
import { defineConfig } from "tsdown";
import { createStage3DecoratorSwcPlugin } from "../../../../scripts/tooling/stage3-decorators-swc.ts";
import { runTurboPrerequisites } from "../../../../scripts/tooling/turbo-prerequisites.ts";

export default defineConfig({
	entry: {
		index: "./src/index.ts",
	},
	hooks: {
		"build:prepare": () =>
			runTurboPrerequisites({
				workspaceRoot: path.resolve(import.meta.dirname, "../../../.."),
				packageRoot: import.meta.dirname,
				includeSelf: false,
			}),
	},
	plugins: [createStage3DecoratorSwcPlugin({ roots: [import.meta.dirname] })],
	format: "esm",
	dts: true,
	sourcemap: true,
	clean: true,
	outDir: "./dist",
});
