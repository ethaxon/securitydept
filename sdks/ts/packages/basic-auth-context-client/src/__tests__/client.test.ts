import { describe, expect, it } from "vitest";
import { BasicAuthContextClient } from "../client";
import { AuthGuardResultKind } from "../types";

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

	it("should return ok on 401 outside zone", () => {
		const result = client.handleUnauthorized("/api/v1/me", 401);
		expect(result.kind).toBe(AuthGuardResultKind.Ok);
	});
});
