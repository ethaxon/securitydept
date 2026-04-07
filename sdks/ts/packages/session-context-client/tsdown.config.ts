import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "./src/index.ts",
		"web/index": "./src/web/index.ts",
		"react/index": "./src/react/index.tsx",
		"server/index": "./src/server/index.ts",
	},
	format: "esm",
	dts: true,
	sourcemap: true,
	clean: true,
	external: ["react"],
});
