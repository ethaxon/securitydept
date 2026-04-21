import {
	AuthGuardRedirectStatus,
	AuthGuardResultKind,
	BasicAuthContextClient,
} from "@securitydept/basic-auth-context-client";
import { BasicAuthContextService } from "@securitydept/basic-auth-context-client-angular";
import { describe, expect, it } from "vitest";

describe("BasicAuthContextService", () => {
	it("stays a thin facade over core zone, redirect, and guard helpers", () => {
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
		const service = new BasicAuthContextService(client);

		expect(service.isInZone("/internal/basic/reports")).toBe(true);
		expect(service.isInZone("/public")).toBe(false);

		const zone = service.zoneForPath("/internal/basic/reports");
		expect(zone).toEqual(
			expect.objectContaining({
				zonePrefix: "/internal/basic",
				loginPath: "/internal/basic/signin",
				logoutPath: "/internal/basic/signout",
			}),
		);

		expect(service.loginUrl(zone!, "/playground/basic-auth")).toBe(
			"https://auth.example.com/internal/basic/signin?post_auth_redirect_uri=%2Fplayground%2Fbasic-auth",
		);
		expect(service.logoutUrl(zone!)).toBe(
			"https://auth.example.com/internal/basic/signout",
		);
		expect(service.handleUnauthorized("/internal/basic/reports", 401)).toEqual({
			kind: AuthGuardResultKind.Redirect,
			status: AuthGuardRedirectStatus.Found,
			location:
				"https://auth.example.com/internal/basic/signin?post_auth_redirect_uri=%2Finternal%2Fbasic%2Freports",
		});
	});
});
