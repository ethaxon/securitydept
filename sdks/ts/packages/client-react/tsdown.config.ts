import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		// React planner-host Context/Provider/Hook for auth-coordination.
		index: "./src/planner-host/index.tsx",
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
