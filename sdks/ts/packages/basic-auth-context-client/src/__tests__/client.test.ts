import { describe, expect, it } from "vitest";
import { BasicAuthContextClient, readBasicAuthBoundaryKind } from "../client";
import {
	AuthGuardRedirectStatus,
	AuthGuardResultKind,
	BasicAuthBoundaryKind,
} from "../types";

describe("BasicAuthContextClient", () => {
	const client = new BasicAuthContextClient({
		baseUrl: "https://auth.example.com",
		zones: [
			{ zonePrefix: "/basic" },
			{
				zonePrefix: "/internal/basic",
				loginSubpath: "/signin",
				logoutSubpath: "/signout",
			},
		],
	});

	it("should detect zone for matching path", () => {
		expect(client.isInZone("/basic")).toBe(true);
		expect(client.isInZone("/basic/login")).toBe(true);
		expect(client.isInZone("/internal/basic/something")).toBe(true);
	});

	it("should not detect zone for non-matching path", () => {
		expect(client.isInZone("/api/v1/me")).toBe(false);
		expect(client.isInZone("/basically")).toBe(false);
	});

	it("should build login URL with zone defaults", () => {
		const zone = client.zoneForPath("/basic")!;
		expect(zone).toBeDefined();
		expect(client.loginUrl(zone)).toBe("https://auth.example.com/basic/login");
	});

	it("should build login URL with post-auth redirect", () => {
		const zone = client.zoneForPath("/basic")!;
		const url = client.loginUrl(zone, "/dashboard");
		expect(url).toContain("post_auth_redirect_uri=%2Fdashboard");
	});

	it("should build login URL directly from a stable zone prefix", () => {
		expect(
			client.loginUrlForZonePrefix("/basic", "/playground/basic-auth"),
		).toBe(
			"https://auth.example.com/basic/login?post_auth_redirect_uri=%2Fplayground%2Fbasic-auth",
		);
	});

	it("should build logout URL for custom zone", () => {
		const zone = client.zoneForPath("/internal/basic/page")!;
		expect(client.logoutUrl(zone)).toBe(
			"https://auth.example.com/internal/basic/signout",
		);
	});

	it("should return redirect instruction on 401 in zone", () => {
		const result = client.handleUnauthorized("/basic/api/data", 401);
		expect(result.kind).toBe(AuthGuardResultKind.Redirect);
		if (result.kind === AuthGuardResultKind.Redirect) {
			expect(result.location).toContain("/basic/login");
		}
	});

	it("should build zone-aware redirect instructions for multi-zone custom login paths", () => {
		const client = new BasicAuthContextClient({
			baseUrl: "https://auth.example.com",
			postAuthRedirectParam: "return_to",
			zones: [
				{ zonePrefix: "/basic" },
				{
					zonePrefix: "/internal/basic",
					loginSubpath: "/signin",
					logoutSubpath: "/signout",
				},
			],
		});

		const result = client.handleUnauthorized(
			"/internal/basic/reports?tab=members#invite",
			401,
		);

		expect(result).toEqual({
			kind: AuthGuardResultKind.Redirect,
			status: AuthGuardRedirectStatus.Found,
			location:
				"https://auth.example.com/internal/basic/signin?return_to=%2Finternal%2Fbasic%2Freports%3Ftab%3Dmembers%23invite",
		});
	});

	it("should prefer the most specific zone when overlapping prefixes both match", () => {
		const client = new BasicAuthContextClient({
			baseUrl: "https://auth.example.com",
			zones: [
				{ zonePrefix: "/basic" },
				{ zonePrefix: "/basic/admin", loginSubpath: "/signin" },
			],
		});

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

	it("should return ok on 401 outside zone", () => {
		const result = client.handleUnauthorized("/api/v1/me", 401);
		expect(result.kind).toBe(AuthGuardResultKind.Ok);
	});

	it("should classify browser-visible boundary kinds without app-local glue", () => {
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
			}),
		).toBe(BasicAuthBoundaryKind.LogoutPoison);
	});
});
