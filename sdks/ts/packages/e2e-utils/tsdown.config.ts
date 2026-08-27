import path from "node:path";
import { defineConfig } from "tsdown";
import { SDK_DECLARATION_OPTIONS } from "../../../../scripts/tooling/sdk-declarations.ts";
import { runTurboPrerequisites } from "../../../../scripts/tooling/turbo-prerequisites.ts";

export default defineConfig({
	entry: { index: "./src/index.ts" },
	hooks: {
		"build:prepare": () =>
			runTurboPrerequisites({
				workspaceRoot: path.resolve(import.meta.dirname, "../../../.."),
				packageRoot: import.meta.dirname,
				includeSelf: false,
			}),
	},
	format: "esm",
	dts: SDK_DECLARATION_OPTIONS,
	sourcemap: true,
	clean: true,
	outDir: "./dist",
});
