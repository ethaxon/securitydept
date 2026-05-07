import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const forbiddenFallbacks = [
	"requireDefaultPageLocationCapability(",
	"requireDefaultPageLocationHistoryCapability(",
	"requirePageClientEnvironment(",
	"createDefaultBackendOidcModePageCallbackCapability(",
];

const guardedHelperFiles = [
	new URL(
		"../../../../basic-auth-context-client/src/web/login-redirect.ts",
		import.meta.url,
	),
	new URL(
		"../../../../basic-auth-context-client/src/web/redirect.ts",
		import.meta.url,
	),
	new URL(
		"../../../../session-context-client/src/web/index.ts",
		import.meta.url,
	),
	new URL(
		"../../../../token-set-context-client/src/backend-oidc-mode/web/browser.ts",
		import.meta.url,
	),
	new URL(
		"../../../../token-set-context-client/src/frontend-oidc-mode/client.ts",
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
});
