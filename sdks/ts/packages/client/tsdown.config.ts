import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "./src/index.ts",
		"rx/index": "./src/rx/index.ts",
		"server/index": "./src/server/index.ts",
		"test/index": "./src/test/index.ts",
		"web/index": "./src/web/index.ts",
		"webext/index": "./src/webext/index.ts",
	},
	format: "esm",
	dts: true,
	sourcemap: true,
	clean: true,
	outDir: "./dist",
});
