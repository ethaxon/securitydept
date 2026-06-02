import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		// Root token-set React adapter surface.
		index: "./src/index.tsx",
		// Token-set-specific TanStack Router auth-coordination helpers.
		"tanstack-router/index": "./src/tanstack-router/index.ts",
	},
	target: "es2022",
	format: "esm",
	dts: true,
	sourcemap: true,
	clean: true,
	deps: {
		neverBundle: ["react", "react-dom"],
	},
	outDir: "./dist",
});
