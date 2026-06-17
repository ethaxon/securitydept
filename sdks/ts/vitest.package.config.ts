import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";
import { createStage3DecoratorSwcPlugin } from "../../scripts/tooling/stage3-decorators-swc.ts";

interface PackageManifest {
	readonly name: string;
}

const packageRoot = process.cwd();
const manifest = JSON.parse(
	readFileSync(path.join(packageRoot, "package.json"), "utf8"),
) as PackageManifest;
const isAngularPackage = manifest.name.endsWith("-angular");
const isReactPackage = manifest.name.endsWith("-react");
const isCi = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

export default defineConfig({
	root: packageRoot,
	plugins: [createStage3DecoratorSwcPlugin({ roots: [packageRoot] })],
	test: {
		include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
		testTimeout: isCi ? 15_000 : undefined,
		globalSetup: [path.join(import.meta.dirname, "vitest.global-setup.ts")],
		setupFiles: [
			...(isAngularPackage
				? [path.join(import.meta.dirname, "vitest.angular-setup.ts")]
				: []),
			...(isReactPackage
				? [path.join(import.meta.dirname, "vitest.react-setup.ts")]
				: []),
		],
	},
});
