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
		],
		globalSetup: [
			path.resolve(import.meta.dirname, "../../sdks/ts/vitest.global-setup.ts"),
		],
	},
});
