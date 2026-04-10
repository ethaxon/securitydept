// Basic-auth server minimal entry — standalone adopter-facing evidence
//
// This test proves the standalone server-host entry path for
// basic-auth-context-client, exercising the canonical import surface
// from @securitydept/basic-auth-context-client/server.
//
// An adopter reading this file should understand "how do I use
// basic-auth zone helpers in a server request handler?" in one glance.

import type {
	CreateBasicAuthServerHelperOptions,
	ServerRedirectInstruction,
} from "@securitydept/basic-auth-context-client/server";
import { createBasicAuthServerHelper } from "@securitydept/basic-auth-context-client/server";
import { describe, expect, it } from "vitest";

describe("basic-auth server minimal entry", () => {
	it("shows the standalone server entry path: helper construction → handleUnauthorized → redirect instruction", () => {
		// 1. Create a server helper with zone config.
		const options: CreateBasicAuthServerHelperOptions = {
			config: {
				baseUrl: "https://auth.example.com",
				zones: [{ zonePrefix: "/api" }],
			},
		};
		const helper = createBasicAuthServerHelper(options);

		// 2. Simulate a 401 from the backend for a path inside a zone.
		const redirect: ServerRedirectInstruction | null =
			helper.handleUnauthorized({ path: "/api/protected" });

		// 3. The helper produces a host-neutral redirect instruction.
		//    The host (Next.js, Remix, Express, etc.) translates this
		//    into its own response format.
		expect(redirect).not.toBeNull();
		expect(redirect?.statusCode).toBe(302);
		expect(redirect?.destination).toContain(
			"https://auth.example.com/api/login",
		);
	});

	it("shows loginUrlForPath and logoutUrlForPath for server-side URL generation", () => {
		const helper = createBasicAuthServerHelper({
			config: {
				baseUrl: "https://auth.example.com",
				zones: [{ zonePrefix: "/admin" }],
			},
		});

		// loginUrlForPath returns the login URL with post_auth_redirect_uri.
		const loginUrl = helper.loginUrlForPath("/admin/dashboard");
		expect(loginUrl).toContain("https://auth.example.com/admin/login");
		expect(loginUrl).toContain("post_auth_redirect_uri=");

		// logoutUrlForPath returns the logout URL for the zone.
		const logoutUrl = helper.logoutUrlForPath("/admin/settings");
		expect(logoutUrl).toBe("https://auth.example.com/admin/logout");

		// Paths outside any zone return null.
		expect(helper.loginUrlForPath("/public/page")).toBeNull();
		expect(helper.logoutUrlForPath("/public/page")).toBeNull();
	});
});
