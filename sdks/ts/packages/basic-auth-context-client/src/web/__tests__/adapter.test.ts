import type { RouterTrait } from "@securitydept/client";
import { createRouterForNativeWeb } from "@securitydept/client/web";
import { describe, expect, it, vi } from "vitest";
import { BasicAuthContextClient } from "../../client";
import { AuthGuardRedirectStatus, AuthGuardResultKind } from "../../types";
import { loginWithRedirect, performRedirect } from "../index";

function createPageLocationCapability(href: string): RouterTrait & {
	location: { href: string; hash: string; pathname: string; search: string };
} {
	const url = new URL(href);
	const location = {
		href,
		hash: url.hash,
		pathname: url.pathname,
		search: url.search,
	};
	return {
		...createRouterForNativeWeb({ location }),
		location,
	};
}

describe("basic-auth web adapter", () => {
	it("writes location.href when given a redirect result", async () => {
		const environment = createPageLocationCapability(
			"https://app.example.com/current",
		);

		await performRedirect(
			{
				kind: AuthGuardResultKind.Redirect,
				status: AuthGuardRedirectStatus.Found,
				location:
					"https://auth.example.com/basic/login?post_auth_redirect_uri=%2Fbasic%2Fapi%2Fgroups",
			},
			{ environment },
		);

		expect(environment.location.href).toBe(
			"https://auth.example.com/basic/login?post_auth_redirect_uri=%2Fbasic%2Fapi%2Fgroups",
		);
	});

	it("does not redirect for non-redirect results", async () => {
		const environment = createPageLocationCapability(
			"https://app.example.com/current",
		);

		await performRedirect(
			{
				kind: AuthGuardResultKind.Ok,
				value: {
					location: "https://auth.example.com/should-not-run",
				},
			},
			{ environment },
		);

		expect(environment.location.href).toBe("https://app.example.com/current");
	});

	it("consumes the root client's neutral redirect result without framework glue", async () => {
		const client = new BasicAuthContextClient({
			baseUrl: "https://auth.example.com",
			zones: [{ zonePrefix: "/basic" }],
		});
		const result = client.handleUnauthorized("/basic/api/groups", 401);

		const environment = createPageLocationCapability(
			"https://app.example.com/current",
		);

		expect(result.kind).toBe(AuthGuardResultKind.Redirect);
		await performRedirect(result, { environment });

		expect(environment.location.href).toBe(
			"https://auth.example.com/basic/login?post_auth_redirect_uri=%2Fbasic%2Fapi%2Fgroups",
		);
	});

	it("preserves query-bearing route context when consuming a host-provided redirect result", async () => {
		const client = new BasicAuthContextClient({
			baseUrl: "https://auth.example.com",
			postAuthRedirectParam: "return_to",
			zones: [{ zonePrefix: "/basic" }],
		});
		const result = client.handleUnauthorized(
			"/basic/api/groups?tab=members",
			401,
		);

		const environment = createPageLocationCapability(
			"https://app.example.com/current",
		);

		expect(result.kind).toBe(AuthGuardResultKind.Redirect);
		await performRedirect(result, { environment });

		expect(environment.location.href).toBe(
			"https://auth.example.com/basic/login?return_to=%2Fbasic%2Fapi%2Fgroups%3Ftab%3Dmembers",
		);
	});

	it("preserves query-and-hash-bearing route context when consuming a host-provided redirect result", async () => {
		const client = new BasicAuthContextClient({
			baseUrl: "https://auth.example.com",
			zones: [{ zonePrefix: "/basic" }],
		});
		const result = client.handleUnauthorized(
			"/basic/api/groups?tab=members#invite",
			401,
		);

		const environment = createPageLocationCapability(
			"https://app.example.com/current",
		);

		expect(result.kind).toBe(AuthGuardResultKind.Redirect);
		await performRedirect(result, { environment });

		expect(environment.location.href).toBe(
			"https://auth.example.com/basic/login?post_auth_redirect_uri=%2Fbasic%2Fapi%2Fgroups%3Ftab%3Dmembers%23invite",
		);
	});

	it("preserves hash-bearing route context when a custom redirect param is configured", async () => {
		const client = new BasicAuthContextClient({
			baseUrl: "https://auth.example.com",
			postAuthRedirectParam: "return_to",
			zones: [{ zonePrefix: "/basic" }],
		});
		const result = client.handleUnauthorized("/basic/api/groups#invite", 401);

		const environment = createPageLocationCapability(
			"https://app.example.com/current",
		);

		expect(result.kind).toBe(AuthGuardResultKind.Redirect);
		await performRedirect(result, { environment });

		expect(environment.location.href).toBe(
			"https://auth.example.com/basic/login?return_to=%2Fbasic%2Fapi%2Fgroups%23invite",
		);
	});

	it("fails without explicit environment instead of reading a global window", async () => {
		const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			"window",
		);
		let windowRead = false;

		Object.defineProperty(globalThis, "window", {
			configurable: true,
			get() {
				windowRead = true;
				return {
					location: {
						href: "https://app.example.com/current",
						hash: "",
						pathname: "/basic/api/groups",
					},
				};
			},
		});

		try {
			const client = new BasicAuthContextClient({
				baseUrl: "https://auth.example.com",
				zones: [{ zonePrefix: "/basic" }],
			});

			await expect(loginWithRedirect(client)).rejects.toThrow(
				/createEnvironmentForNativeWeb/,
			);
			await expect(
				performRedirect({
					kind: AuthGuardResultKind.Redirect,
					status: AuthGuardRedirectStatus.Found,
					location: "https://auth.example.com/basic/login",
				}),
			).rejects.toThrow(/createEnvironmentForNativeWeb/);
			expect(windowRead).toBe(false);
		} finally {
			vi.unstubAllGlobals();
			if (originalWindowDescriptor) {
				Object.defineProperty(globalThis, "window", originalWindowDescriptor);
			} else {
				Reflect.deleteProperty(globalThis, "window");
			}
		}
	});
});
