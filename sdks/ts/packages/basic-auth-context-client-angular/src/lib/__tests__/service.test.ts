import { createEnvironmentInjector, Injector } from "@angular/core";
import {
	AuthGuardRedirectStatus,
	AuthGuardResultKind,
	BasicAuthContextClient,
} from "@securitydept/basic-auth-context-client";
import { createFoundationEnvironment } from "@securitydept/client";
import { provideEnvironment } from "@securitydept/client-angular";
import { describe, expect, it } from "vitest";
import { BasicAuthContextService, provideBasicAuthContext } from "../index";

describe("BasicAuthContextService", () => {
	it("extends the core client while adding Angular destroy lifecycle", async () => {
		const injector = createEnvironmentInjector(
			[
				provideEnvironment({
					environment: createFoundationEnvironment({
						transport: {
							async execute() {
								throw new Error("Unexpected transport call.");
							},
						},
					}),
				}),
				...provideBasicAuthContext({
					config: {
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
				}),
			],
			Injector.NULL as never,
		);
		const service = injector.get(BasicAuthContextService);

		expect(service).toBeInstanceOf(BasicAuthContextClient);

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

		injector.destroy();
		await expect(
			service.refresh({ path: "/internal/basic/reports" }),
		).rejects.toMatchObject({
			code: "basic_auth.client_disposed",
		});
	});
});
