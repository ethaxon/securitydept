import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		// backend-oidc-mediated mode — canonical entries.
		"backend-oidc-mediated-mode/index":
			"./src/backend-oidc-mediated-mode/index.ts",
		"backend-oidc-mediated-mode/web/index":
			"./src/backend-oidc-mediated-mode/web/index.ts",
		"backend-oidc-mediated-mode/react/index":
			"./src/backend-oidc-mediated-mode/react/index.tsx",
		// backend-oidc-pure mode — formal frontend-facing surface.
		"backend-oidc-pure-mode/index": "./src/backend-oidc-pure-mode/index.ts",
		// frontend-oidc mode — browser-native OIDC (wraps oauth4webapi).
		"frontend-oidc-mode/index": "./src/frontend-oidc-mode/index.ts",
		// Shared token-lifecycle substrate.
		"orchestration/index": "./src/orchestration/index.ts",
	},
	format: "esm",
	dts: true,
	sourcemap: true,
	clean: true,
	external: ["react", "oauth4webapi"],
});
