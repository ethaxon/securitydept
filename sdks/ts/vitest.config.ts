import path from "node:path";
import { defineConfig } from "vitest/config";

const isCi = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

export default defineConfig({
	test: {
		include: ["examples/**/*.test.ts", "tests/**/*.test.ts"],
		testTimeout: isCi ? 15_000 : undefined,
		globalSetup: [path.join(import.meta.dirname, "vitest.global-setup.ts")],
		setupFiles: ["./vitest.angular-setup.ts", "./vitest.react-setup.ts"],
	},
});
