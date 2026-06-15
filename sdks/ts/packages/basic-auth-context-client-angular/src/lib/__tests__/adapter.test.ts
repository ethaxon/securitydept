import { HttpClient, HttpResponse } from "@angular/common/http";
import { createEnvironmentInjector, Injector } from "@angular/core";
import { Router } from "@angular/router";
import {
	AuthGuardRedirectStatus,
	AuthGuardResultKind,
	BasicAuthContextClient,
} from "@securitydept/basic-auth-context-client";
import { createFoundationEnvironment } from "@securitydept/client";
import { provideEnvironment } from "@securitydept/client-angular";
import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { BASIC_AUTH_CONTEXT_CLIENT, provideBasicAuthContext } from "../index";

function provideAngularEnvironmentDeps() {
	return [
		{
			provide: Router,
			useValue: {
				url: "/",
				navigateByUrl: vi.fn(async () => true),
			},
		},
		{
			provide: HttpClient,
			useValue: {
				request: vi.fn(() => of(new HttpResponse({ status: 200 }))),
			},
		},
	];
}

describe("BasicAuthContextClient Angular adapter", () => {
	it("bridges the core client into Angular DI and lifecycle", async () => {
		const injector = createEnvironmentInjector(
			[
				...provideAngularEnvironmentDeps(),
				provideEnvironment({
					createBaseEnvironment: createFoundationEnvironment,
					transport: {
						async execute() {
							throw new Error("Unexpected transport call.");
						},
					},
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
		const client = injector.get(BASIC_AUTH_CONTEXT_CLIENT);

		expect(client).toBeInstanceOf(BasicAuthContextClient);

		expect(client.isInZone("/internal/basic/reports")).toBe(true);
		expect(client.isInZone("/public")).toBe(false);

		const zone = client.zoneForPath("/internal/basic/reports");
		expect(zone).toEqual(
			expect.objectContaining({
				zonePrefix: "/internal/basic",
				loginPath: "/internal/basic/signin",
				logoutPath: "/internal/basic/signout",
			}),
		);

		expect(client.loginUrl(zone!, "/playground/basic-auth")).toBe(
			"https://auth.example.com/internal/basic/signin?post_auth_redirect_uri=%2Fplayground%2Fbasic-auth",
		);
		expect(client.logoutUrl(zone!)).toBe(
			"https://auth.example.com/internal/basic/signout",
		);
		expect(client.handleUnauthorized("/internal/basic/reports", 401)).toEqual({
			kind: AuthGuardResultKind.Redirect,
			status: AuthGuardRedirectStatus.Found,
			location:
				"https://auth.example.com/internal/basic/signin?post_auth_redirect_uri=%2Finternal%2Fbasic%2Freports",
		});

		injector.destroy();
		await expect(
			client.refresh({ path: "/internal/basic/reports" }),
		).rejects.toMatchObject({
			kind: "cancelled",
			code: "client.cancelled",
		});
	});
});
