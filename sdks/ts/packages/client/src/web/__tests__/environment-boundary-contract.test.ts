import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const forbiddenFallbacks = [
	"options.environment ?? createFoundationEnvironment(",
	"?? createFoundationEnvironment(",
];

const guardedHelperFiles = [
	new URL(
		"../../../../token-set-context-client/src/orchestration/client/popup/relay.ts",
		import.meta.url,
	),
	new URL(
		"../../../../token-set-context-client/src/frontend-oidc-mode/client/client.ts",
		import.meta.url,
	),
	new URL(
		"../../../../token-set-context-client/src/frontend-oidc-mode/config/config-source.ts",
		import.meta.url,
	),
];

describe("environment boundary contract", () => {
	it("keeps regular web helpers free of default page resolver fallbacks", () => {
		for (const fileUrl of guardedHelperFiles) {
			const source = readFileSync(fileUrl, "utf8");

			for (const forbiddenFallback of forbiddenFallbacks) {
				expect(source).not.toContain(forbiddenFallback);
			}
		}
	});

	it("keeps config projection resolution behind environment capabilities", () => {
		const source = readFileSync(guardedHelperFiles[2], "utf8");

		expect(source).not.toContain("globalThis.fetch");
		expect(source).not.toContain("globalThis.localStorage");
		expect(source).not.toContain("globalThis.sessionStorage");
		expect(source).not.toContain("window.");
	});
});
