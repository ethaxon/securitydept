/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("token-set callback import boundary", () => {
	it("keeps the shared React callback surface free of frontend-mode presenter imports", () => {
		const source = readFileSync(
			new URL("../token-set-callback.tsx", import.meta.url),
			"utf8",
		);

		expect(source).not.toContain("describeFrontendOidcModeCallbackError");
		expect(source).not.toContain(
			"@securitydept/token-set-context-client/frontend-oidc-mode",
		);
		expect(source).not.toContain("fromPromise");
		expect(source).not.toContain(".client.handleCallback(");
	});
});
