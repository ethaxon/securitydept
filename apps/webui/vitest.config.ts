import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": path.join(import.meta.dirname, "src"),
		},
	},
	test: {
		include: [
			"src/**/__tests__/**/*.test.ts",
			"src/**/__tests__/**/*.test.tsx",
			"e2e/support/**/__tests__/**/*.test.ts",
			"../../scripts/tooling/**/__tests__/**/*.test.ts",
		],
		globalSetup: [
			path.resolve(import.meta.dirname, "../../sdks/ts/vitest.global-setup.ts"),
		],
	},
});
