/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const examplesRoot = path.resolve(import.meta.dirname, "..");

const recommendedExamples = [
	{
		path: "session-context/react-minimal-entry.test.ts",
		markers: ["createEnvironmentForReact", "useSuspenseResourceValue"],
	},
	{
		path: "backend-oidc-mode/react-minimal-entry.test.ts",
		markers: ["provideBackendOidcModeClient", "BACKEND_OIDC_MODE_CLIENT"],
	},
	{
		path: "frontend-oidc-mode/minimal-entry.test.ts",
		markers: ["provideFrontendOidcModeClient", "loginWithRedirect"],
	},
	{
		path: "token-set/react-multi-client-registry-baseline.test.ts",
		markers: [
			"createBackendOidcModeClientFactory",
			"clientResourceFor",
			"useSuspenseResourceValue",
		],
	},
] as const;

function exampleFiles(directory: string): string[] {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			return exampleFiles(entryPath);
		}
		return entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")
			? [entryPath]
			: [];
	});
}

describe("adopter example contract", () => {
	it("keeps recommended examples on current public composition APIs", () => {
		for (const example of recommendedExamples) {
			const content = fs.readFileSync(
				path.join(examplesRoot, example.path),
				"utf8",
			);
			for (const marker of example.markers) {
				expect(
					content,
					`${example.path} should demonstrate ${marker}`,
				).toContain(marker);
			}
		}
	});

	it("does not model clients by mutating prototypes or calling private operations", () => {
		const violations = exampleFiles(examplesRoot).flatMap((file) => {
			if (file === import.meta.filename) {
				return [];
			}
			const content = fs.readFileSync(file, "utf8");
			return [
				"Object.setPrototypeOf",
				"._handleCallbackOperation",
				"._authorizeUrlWithState",
			].flatMap((pattern) =>
				content.includes(pattern)
					? [`${path.relative(examplesRoot, file)}: ${pattern}`]
					: [],
			);
		});

		expect(violations).toEqual([]);
	});
});
