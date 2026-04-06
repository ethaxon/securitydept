import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		// backend-oidc mode — canonical unified surface.
		"backend-oidc-mode/index": "./src/backend-oidc-mode/index.ts",
		"backend-oidc-mode/web/index": "./src/backend-oidc-mode/web/index.ts",
		"backend-oidc-mode/react/index": "./src/backend-oidc-mode/react/index.tsx",
		// frontend-oidc mode — browser-native OIDC (wraps oauth4webapi).
		"frontend-oidc-mode/index": "./src/frontend-oidc-mode/index.ts",
		// Shared token-lifecycle substrate.
		"orchestration/index": "./src/orchestration/index.ts",
		// Access-token substrate — cross-mode capability contracts.
		"access-token-substrate/index": "./src/access-token-substrate/index.ts",
	},
	format: "esm",
	dts: true,
	sourcemap: true,
	clean: true,
	external: ["react", "oauth4webapi"],
});
