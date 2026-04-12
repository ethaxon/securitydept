import { defineConfig } from "tsdown";

export default defineConfig({
	entry: { index: "./src/index.tsx" },
	target: "es2022",
	format: "esm",
	dts: true,
	sourcemap: true,
	clean: true,
	deps: { neverBundle: ["react", "react-dom"] },
	outDir: "./dist",
});
