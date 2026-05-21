import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		// Root token-set React adapter surface.
		index: "./src/index.tsx",
		// Optional React Query subpath (peer: @tanstack/react-query).
		"react-query/index": "./src/react-query/index.ts",
		// Token-set-specific TanStack Router beforeLoad helper.
		"tanstack-router/index": "./src/tanstack-router/index.ts",
	},
	target: "es2022",
	format: "esm",
	dts: true,
	sourcemap: true,
	clean: true,
	deps: {
		neverBundle: [
			"react",
			"react-dom",
			"@tanstack/react-query",
			"@tanstack/react-router",
		],
	},
	outDir: "./dist",
});
