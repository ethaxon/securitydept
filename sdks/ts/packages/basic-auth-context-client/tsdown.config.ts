import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "./src/index.ts",
		"react/index": "./src/react/index.tsx",
		"web/index": "./src/web/index.ts",
		"server/index": "./src/server/index.ts",
	},
	format: "esm",
	dts: true,
	sourcemap: true,
	clean: true,
	external: ["react"],
});
