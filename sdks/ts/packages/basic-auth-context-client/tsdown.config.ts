import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "./src/index.ts",
		"web/index": "./src/web/index.ts",
		"server/index": "./src/server/index.ts",
	},
	format: "esm",
	dts: true,
	sourcemap: true,
	clean: true,
	outDir: "./dist",
});
