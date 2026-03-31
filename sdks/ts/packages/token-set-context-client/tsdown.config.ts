import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		// Root — backward-compatible bridge (not canonical for any pillar).
		index: "./src/index.ts",
		// Token-set sealed flow — canonical entries.
		"token-set/index": "./src/token-set/index.ts",
		"token-set/web/index": "./src/token-set/web/index.ts",
		"token-set/react/index": "./src/token-set/react/index.tsx",
		// Old paths kept as backward-compatible bridges.
		"web/index": "./src/web/index.ts",
		"react/index": "./src/react/index.tsx",
		// Shared orchestration substrate.
		"orchestration/index": "./src/orchestration/index.ts",
		// Frontend pure OIDC client (wraps oauth4webapi).
		"oidc/index": "./src/oidc/index.ts",
	},
	format: "esm",
	dts: true,
	sourcemap: true,
	clean: true,
	external: ["react", "oauth4webapi"],
});
