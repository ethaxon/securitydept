import {
	AuthGuardResultKind,
	BasicAuthContextClient,
} from "@securitydept/basic-auth-context-client";
import {
	createFoundationEnvironment,
	type FoundationEnvironment,
	UriReferenceString,
} from "@securitydept/client";
import { createRouterForNativeWeb } from "@securitydept/client/web";
import { afterEach, describe, expect, it, vi } from "vitest";

function createPageEnvironment(href: string): FoundationEnvironment & {
	location: { href: string; hash: string; pathname: string; search: string };
} {
	const url = new URL(href);
	const location = {
		href,
		hash: url.hash,
		pathname: url.pathname,
		search: url.search,
	};
	return Object.assign(
		createFoundationEnvironment({
			transport: {
				async execute() {
					throw new Error("Unexpected transport call.");
				},
			},
			router: createRouterForNativeWeb({ location }),
		}),
		{
			location,
		},
	);
}

describe("external basic-auth guard scenario", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("lets consumers distinguish zone hits from misses and consume redirects explicitly", async () => {
		const environment = createPageEnvironment(
			"https://app.example.com/current",
		);
		const client = BasicAuthContextClient.fromEnvironmentConfig({
			config: {
				baseUrl: "https://auth.example.com",
				zones: [{ zonePrefix: "/basic" }],
			},
			environment,
		});

		const outOfZone = client.handleUnauthorized("/public/health", 401);
		const inZone = client.handleUnauthorized("/basic/api/groups", 401);

		expect(outOfZone).toEqual({
			kind: AuthGuardResultKind.Ok,
			value: null,
		});
		expect(inZone.kind).toBe(AuthGuardResultKind.Redirect);

		if (inZone.kind === AuthGuardResultKind.Redirect) {
			await environment.router!.navigate({
				url: UriReferenceString.parse(inZone.location),
				intent: "auth_redirect",
				mode: "external",
			});
		}

		expect(environment.location.href).toBe(
			"https://auth.example.com/basic/login?post_auth_redirect_uri=%2Fbasic%2Fapi%2Fgroups",
		);
	});

	it("lets consumers keep out-of-zone misses separate while consuming a multi-zone redirect contract explicitly", async () => {
		const environment = createPageEnvironment(
			"https://app.example.com/current",
		);
		const client = BasicAuthContextClient.fromEnvironmentConfig({
			config: {
				baseUrl: "https://auth.example.com",
				zones: [
					{ zonePrefix: "/basic" },
					{
						zonePrefix: "/internal/basic",
						loginSubpath: "/signin",
					},
				],
			},
			environment,
		});

		const outOfZone = client.handleUnauthorized("/public/health?full=1", 401);
		const inZone = client.handleUnauthorized(
			"/internal/basic/reports?tab=members#invite",
			401,
		);

		expect(outOfZone).toEqual({
			kind: AuthGuardResultKind.Ok,
			value: null,
		});
		expect(inZone.kind).toBe(AuthGuardResultKind.Redirect);

		if (inZone.kind === AuthGuardResultKind.Redirect) {
			await environment.router!.navigate({
				url: UriReferenceString.parse(inZone.location),
				intent: "auth_redirect",
				mode: "external",
			});
		}

		expect(environment.location.href).toBe(
			"https://auth.example.com/internal/basic/signin?post_auth_redirect_uri=%2Finternal%2Fbasic%2Freports%3Ftab%3Dmembers%23invite",
		);
	});
});
