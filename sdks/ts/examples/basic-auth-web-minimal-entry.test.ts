import {
	AuthGuardResultKind,
	BasicAuthContextClient,
} from "@securitydept/basic-auth-context-client";
import { performRedirect } from "@securitydept/basic-auth-context-client/web";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("basic-auth web minimal entry", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("shows the standalone browser entry path from neutral redirect result to explicit redirect consumption", () => {
		const client = new BasicAuthContextClient({
			baseUrl: "https://auth.example.com",
			zones: [{ zonePrefix: "/basic" }],
		});
		const result = client.handleUnauthorized("/basic/api/groups", 401);

		expect(result.kind).toBe(AuthGuardResultKind.Redirect);

		vi.stubGlobal("location", { href: "https://app.example.com/current" });
		performRedirect(result);

		expect(globalThis.location.href).toBe(
			"https://auth.example.com/basic/login?post_auth_redirect_uri=%2Fbasic%2Fapi%2Fgroups",
		);
	});
});
