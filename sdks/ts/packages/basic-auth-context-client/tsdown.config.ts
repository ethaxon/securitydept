import { defineConfig } from "tsdown";
import { createStage3DecoratorSwcPlugin } from "../../../../scripts/ts/stage3-decorator-swc.ts";

export default defineConfig({
	entry: {
		index: "./src/index.ts",
	},
	plugins: [createStage3DecoratorSwcPlugin({ roots: [import.meta.dirname] })],
	format: "esm",
	dts: true,
	sourcemap: true,
	clean: true,
	outDir: "./dist",
});
