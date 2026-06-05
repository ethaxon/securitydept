import {
	createFoundationEnvironment,
	createTracing,
	type FoundationEnvironment,
	type HttpRequest,
	type HttpResponse,
} from "@securitydept/client";
import { createRouterForNativeWeb } from "@securitydept/client/web";
import { describe, expect, it } from "vitest";
import { BasicAuthContextClient, readBasicAuthBoundaryKind } from "../client";
import {
	AuthGuardRedirectStatus,
	AuthGuardResultKind,
	BasicAuthBoundaryKind,
} from "../types";

function createBasicAuthEnvironment(options: {
	response?: HttpResponse;
	onRequest?: (request: HttpRequest) => void;
	routerUrl?: string;
}): FoundationEnvironment {
	const location = options.routerUrl
		? {
				hash: new URL(options.routerUrl).hash,
				href: options.routerUrl,
				pathname: new URL(options.routerUrl).pathname,
				search: new URL(options.routerUrl).search,
			}
		: undefined;
	return createFoundationEnvironment({
		transport: {
			async execute(request) {
				options.onRequest?.(request);
				return options.response ?? { status: 204, headers: {}, body: null };
			},
		},
		router: location ? createRouterForNativeWeb({ location }) : undefined,
	});
}

function createClient(environment = createBasicAuthEnvironment({})) {
	return new BasicAuthContextClient(
		{
			baseUrl: "https://auth.example.com",
			probePath: "/basic/api/entries",
			zones: [
				{ zonePrefix: "/basic" },
				{
					zonePrefix: "/internal/basic",
					loginSubpath: "/signin",
					logoutSubpath: "/signout",
				},
			],
		},
		environment,
	);
}

describe("BasicAuthContextClient", () => {
	it("keeps zone and URL helpers host-neutral", () => {
		const client = createClient();

		expect(client.isInZone("/basic")).toBe(true);
		expect(client.isInZone("/basic/login")).toBe(true);
		expect(client.isInZone("/internal/basic/something")).toBe(true);
		expect(client.isInZone("/api/v1/me")).toBe(false);
		expect(client.isInZone("/basically")).toBe(false);

		const basicZone = client.zoneForPath("/basic")!;
		const internalZone = client.zoneForPath("/internal/basic/page")!;
		expect(client.loginUrl(basicZone)).toBe(
			"https://auth.example.com/basic/login",
		);
		expect(client.loginUrl(basicZone, "/dashboard")).toContain(
			"post_auth_redirect_uri=%2Fdashboard",
		);
		expect(
			client.loginUrlForZonePrefix("/basic", "/playground/basic-auth"),
		).toBe(
			"https://auth.example.com/basic/login?post_auth_redirect_uri=%2Fplayground%2Fbasic-auth",
		);
		expect(client.logoutUrl(internalZone)).toBe(
			"https://auth.example.com/internal/basic/signout",
		);
	});

	it("keeps handleUnauthorized redirect behavior", () => {
		const client = createClient();
		const result = client.handleUnauthorized("/basic/api/data", 401);
		expect(result.kind).toBe(AuthGuardResultKind.Redirect);
		if (result.kind === AuthGuardResultKind.Redirect) {
			expect(result.location).toContain("/basic/login");
		}
		expect(client.handleUnauthorized("/api/v1/me", 401).kind).toBe(
			AuthGuardResultKind.Ok,
		);
	});

	it("builds zone-aware redirect instructions for custom login paths", () => {
		const client = new BasicAuthContextClient(
			{
				baseUrl: "https://auth.example.com",
				zones: [
					{ zonePrefix: "/basic" },
					{
						zonePrefix: "/internal/basic",
						loginSubpath: "/signin",
						logoutSubpath: "/signout",
					},
				],
			},
			createBasicAuthEnvironment({}),
		);

		const result = client.handleUnauthorized(
			"/internal/basic/reports?tab=members#invite",
			401,
		);

		expect(result).toEqual({
			kind: AuthGuardResultKind.Redirect,
			status: AuthGuardRedirectStatus.Found,
			location:
				"https://auth.example.com/internal/basic/signin?post_auth_redirect_uri=%2Finternal%2Fbasic%2Freports%3Ftab%3Dmembers%23invite",
		});
	});

	it("prefers the most specific zone when overlapping prefixes both match", () => {
		const client = new BasicAuthContextClient(
			{
				baseUrl: "https://auth.example.com",
				zones: [
					{ zonePrefix: "/basic" },
					{ zonePrefix: "/basic/admin", loginSubpath: "/signin" },
				],
			},
			createBasicAuthEnvironment({}),
		);

		const zone = client.zoneForPath("/basic/admin/reports");
		const result = client.handleUnauthorized("/basic/admin/reports", 401);

		expect(zone?.loginPath).toBe("/basic/admin/signin");
		expect(result).toEqual({
			kind: AuthGuardResultKind.Redirect,
			status: AuthGuardRedirectStatus.Found,
			location:
				"https://auth.example.com/basic/admin/signin?post_auth_redirect_uri=%2Fbasic%2Fadmin%2Freports",
		});
	});

	it("classifies browser-visible boundary kinds without app-local glue", () => {
		expect(
			readBasicAuthBoundaryKind({
				status: 200,
				requestPath: "/basic/api/entries",
			}),
		).toBe(BasicAuthBoundaryKind.Authenticated);
		expect(
			readBasicAuthBoundaryKind({
				status: 401,
				challengeHeader: 'Basic realm="securitydept"',
				requestPath: "/basic/login",
			}),
		).toBe(BasicAuthBoundaryKind.Challenge);
		expect(
			readBasicAuthBoundaryKind({
				status: 401,
				requestPath: "/basic/logout",
				isLogoutPath: true,
			}),
		).toBe(BasicAuthBoundaryKind.LogoutPoison);
	});

	it("refreshes boundary state from the configured probe path", async () => {
		const traces: unknown[] = [];
		const environment = createBasicAuthEnvironment({
			response: { status: 401, headers: {}, body: null },
			onRequest(request) {
				expect(request.url).toBe("https://auth.example.com/basic/api/entries");
				expect(request.method).toBe("GET");
			},
		});
		const client = new BasicAuthContextClient(
			{
				baseUrl: "https://auth.example.com",
				probePath: "/basic/api/entries",
				zones: [{ zonePrefix: "/basic" }],
			},
			{
				...environment,
				tracing: createTracing({
					subscribers: [{ record: (event) => traces.push(event) }],
				}),
			},
		);

		const snapshot = await client.refresh();

		expect(snapshot).toMatchObject({
			authenticated: false,
			boundaryKind: BasicAuthBoundaryKind.Unauthorized,
			status: 401,
			path: "/basic/api/entries",
		});
		expect(client.boundarySnapshot.get()).toMatchObject({
			status: "resolved",
			value: snapshot,
		});
		expect(client.isAuthenticated.value.get()).toBe(false);
		expect(traces).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "operation.started" }),
				expect.objectContaining({ name: "operation.ended" }),
			]),
		);
	});

	it("requires an explicit probe path for refresh/start", async () => {
		const client = new BasicAuthContextClient(
			{
				baseUrl: "https://auth.example.com",
				zones: [{ zonePrefix: "/basic" }],
			},
			createBasicAuthEnvironment({}),
		);

		await expect(client.refresh()).rejects.toMatchObject({
			code: "basic_auth.probe_path_required",
		});
	});

	it("observes logout poison through logout()", async () => {
		const requests: HttpRequest[] = [];
		const client = createClient(
			createBasicAuthEnvironment({
				response: { status: 401, headers: {}, body: null },
				onRequest(request) {
					requests.push(request);
				},
			}),
		);

		const snapshot = await client.logout({ zonePrefix: "/basic" });

		expect(requests[0]?.url).toBe("https://auth.example.com/basic/logout");
		expect(requests[0]?.method).toBe("POST");
		expect(snapshot.boundaryKind).toBe(BasicAuthBoundaryKind.LogoutPoison);
		expect(snapshot.authenticated).toBe(false);
	});

	it("uses explicit currentPath for loginWithRedirect zone resolution", async () => {
		const environment = createBasicAuthEnvironment({
			routerUrl: "https://app.example.com/basic/api/groups",
		});
		const client = new BasicAuthContextClient(
			{
				baseUrl: "https://auth.example.com",
				zones: [{ zonePrefix: "/basic" }],
			},
			environment,
		);

		await expect(
			client.loginWithRedirect({
				currentPath: "/basic/api/groups",
				postAuthRedirectUri: "https://app.example.com/basic/api/groups",
			}),
		).resolves.toBeUndefined();
		expect(environment.router?.currentUrl()?.toString()).toBe(
			"https://auth.example.com/basic/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fbasic%2Fapi%2Fgroups",
		);
	});

	it("rejects operations after dispose", async () => {
		const client = createClient();
		client.dispose();

		await expect(client.refresh()).rejects.toMatchObject({
			code: "basic_auth.client_disposed",
		});
	});
});
