import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "./src/index.ts",
		"persistence/index": "./src/persistence/index.ts",
		"persistence/web/index": "./src/persistence/web/index.ts",
		"events/index": "./src/events/index.ts",
		"web/index": "./src/web/index.ts",
		"auth-coordination/index": "./src/auth-coordination/index.ts",
		"web-router/index": "./src/web-router/index.ts",
	},
	format: "esm",
	dts: true,
	sourcemap: true,
	clean: true,
	outDir: "./dist",
});
