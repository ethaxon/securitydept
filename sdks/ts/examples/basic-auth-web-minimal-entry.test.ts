import {
	AuthGuardResultKind,
	BasicAuthContextClient,
} from "@securitydept/basic-auth-context-client";
import { performRedirect } from "@securitydept/basic-auth-context-client/web";
import { type RouterTrait } from "@securitydept/client";
import { createRouterForNativeWeb } from "@securitydept/client/web";
import { afterEach, describe, expect, it, vi } from "vitest";

function createPageLocationEnvironment(href: string): RouterTrait & {
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

describe("basic-auth web minimal entry", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("shows the standalone browser entry path from neutral redirect result to explicit redirect consumption", async () => {
		const client = new BasicAuthContextClient({
			baseUrl: "https://auth.example.com",
			zones: [{ zonePrefix: "/basic" }],
		});
		const result = client.handleUnauthorized("/basic/api/groups", 401);

		expect(result.kind).toBe(AuthGuardResultKind.Redirect);

		const environment = createPageLocationEnvironment(
			"https://app.example.com/current",
		);
		await performRedirect(result, { environment });

		expect(environment.location.href).toBe(
			"https://auth.example.com/basic/login?post_auth_redirect_uri=%2Fbasic%2Fapi%2Fgroups",
		);
	});

	it("shows the standalone browser entry path for a zone-aware custom redirect contract", async () => {
		const client = new BasicAuthContextClient({
			baseUrl: "https://auth.example.com",
			postAuthRedirectParam: "return_to",
			zones: [
				{ zonePrefix: "/basic" },
				{
					zonePrefix: "/internal/basic",
					loginSubpath: "/signin",
				},
			],
		});
		const result = client.handleUnauthorized(
			"/internal/basic/reports?tab=members#invite",
			401,
		);

		expect(result.kind).toBe(AuthGuardResultKind.Redirect);

		const environment = createPageLocationEnvironment(
			"https://app.example.com/current",
		);
		await performRedirect(result, { environment });

		expect(environment.location.href).toBe(
			"https://auth.example.com/internal/basic/signin?return_to=%2Finternal%2Fbasic%2Freports%3Ftab%3Dmembers%23invite",
		);
	});
});
