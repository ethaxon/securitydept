import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		// Root export — planner-host plus environment-service React helpers.
		index: "./src/index.ts",
		// TanStack React Router route adapter for auth-coordination.
		"tanstack-router/index": "./src/tanstack-router/index.ts",
	},
	target: "es2022",
	format: "esm",
	dts: true,
	sourcemap: true,
	clean: true,
	deps: {
		neverBundle: ["react", "@tanstack/react-router"],
	},
	outDir: "./dist",
});
