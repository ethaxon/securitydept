import {
	AuthGuardResultKind,
	BasicAuthContextClient,
} from "@securitydept/basic-auth-context-client";
import { performRedirect } from "@securitydept/basic-auth-context-client/web";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("external basic-auth guard scenario", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("lets consumers distinguish zone hits from misses and consume redirects explicitly", () => {
		const client = new BasicAuthContextClient({
			baseUrl: "https://auth.example.com",
			zones: [{ zonePrefix: "/basic" }],
		});

		const outOfZone = client.handleUnauthorized("/public/health", 401);
		const inZone = client.handleUnauthorized("/basic/api/groups", 401);

		expect(outOfZone).toEqual({
			kind: AuthGuardResultKind.Ok,
			value: null,
		});
		expect(inZone.kind).toBe(AuthGuardResultKind.Redirect);

		vi.stubGlobal("location", { href: "https://app.example.com/current" });
		performRedirect(inZone);

		expect(globalThis.location.href).toBe(
			"https://auth.example.com/basic/login?post_auth_redirect_uri=%2Fbasic%2Fapi%2Fgroups",
		);
	});
});
