import { afterEach, describe, expect, it, vi } from "vitest";
import { BasicAuthContextClient } from "../../client";
import { AuthGuardRedirectStatus, AuthGuardResultKind } from "../../types";
import { performRedirect } from "../index";

describe("basic-auth web adapter", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("writes location.href when given a redirect result", () => {
		vi.stubGlobal("location", { href: "https://app.example.com/current" });

		performRedirect({
			kind: AuthGuardResultKind.Redirect,
			status: AuthGuardRedirectStatus.Found,
			location:
				"https://auth.example.com/basic/login?post_auth_redirect_uri=%2Fbasic%2Fapi%2Fgroups",
		});

		expect(globalThis.location.href).toBe(
			"https://auth.example.com/basic/login?post_auth_redirect_uri=%2Fbasic%2Fapi%2Fgroups",
		);
	});

	it("does not redirect for non-redirect results", () => {
		vi.stubGlobal("location", { href: "https://app.example.com/current" });

		performRedirect({
			kind: AuthGuardResultKind.Ok,
			value: {
				location: "https://auth.example.com/should-not-run",
			},
		});

		expect(globalThis.location.href).toBe("https://app.example.com/current");
	});

	it("consumes the root client's neutral redirect result without framework glue", () => {
		const client = new BasicAuthContextClient({
			baseUrl: "https://auth.example.com",
			zones: [{ zonePrefix: "/basic" }],
		});
		const result = client.handleUnauthorized("/basic/api/groups", 401);

		vi.stubGlobal("location", { href: "https://app.example.com/current" });

		expect(result.kind).toBe(AuthGuardResultKind.Redirect);
		performRedirect(result);

		expect(globalThis.location.href).toBe(
			"https://auth.example.com/basic/login?post_auth_redirect_uri=%2Fbasic%2Fapi%2Fgroups",
		);
	});

	it("preserves query-bearing route context when consuming a host-provided redirect result", () => {
		const client = new BasicAuthContextClient({
			baseUrl: "https://auth.example.com",
			postAuthRedirectParam: "return_to",
			zones: [{ zonePrefix: "/basic" }],
		});
		const result = client.handleUnauthorized(
			"/basic/api/groups?tab=members",
			401,
		);

		vi.stubGlobal("location", { href: "https://app.example.com/current" });

		expect(result.kind).toBe(AuthGuardResultKind.Redirect);
		performRedirect(result);

		expect(globalThis.location.href).toBe(
			"https://auth.example.com/basic/login?return_to=%2Fbasic%2Fapi%2Fgroups%3Ftab%3Dmembers",
		);
	});

	it("preserves query-and-hash-bearing route context when consuming a host-provided redirect result", () => {
		const client = new BasicAuthContextClient({
			baseUrl: "https://auth.example.com",
			zones: [{ zonePrefix: "/basic" }],
		});
		const result = client.handleUnauthorized(
			"/basic/api/groups?tab=members#invite",
			401,
		);

		vi.stubGlobal("location", { href: "https://app.example.com/current" });

		expect(result.kind).toBe(AuthGuardResultKind.Redirect);
		performRedirect(result);

		expect(globalThis.location.href).toBe(
			"https://auth.example.com/basic/login?post_auth_redirect_uri=%2Fbasic%2Fapi%2Fgroups%3Ftab%3Dmembers%23invite",
		);
	});

	it("preserves hash-bearing route context when a custom redirect param is configured", () => {
		const client = new BasicAuthContextClient({
			baseUrl: "https://auth.example.com",
			postAuthRedirectParam: "return_to",
			zones: [{ zonePrefix: "/basic" }],
		});
		const result = client.handleUnauthorized("/basic/api/groups#invite", 401);

		vi.stubGlobal("location", { href: "https://app.example.com/current" });

		expect(result.kind).toBe(AuthGuardResultKind.Redirect);
		performRedirect(result);

		expect(globalThis.location.href).toBe(
			"https://auth.example.com/basic/login?return_to=%2Fbasic%2Fapi%2Fgroups%23invite",
		);
	});
});
