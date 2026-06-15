import {
	HttpResponse as AngularHttpResponse,
	HttpClient,
} from "@angular/common/http";
import { DestroyRef, Injector } from "@angular/core";
import { Router } from "@angular/router";
import {
	type BaseTransportTrait,
	type HttpRequest,
	type HttpResponse,
	TRANSPORT_TRAIT_TOKEN,
} from "@securitydept/client";
import { createEnvironmentForTest } from "@securitydept/client/test";
import {
	provideEnvironment,
	provideEnvironmentProvider,
} from "@securitydept/client-angular";
import {
	provideSessionContext,
	SESSION_CONTEXT_CLIENT,
} from "@securitydept/session-context-client-angular";
import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

function createTestTransport(
	handler: (request: HttpRequest) => HttpResponse,
): BaseTransportTrait {
	return {
		async execute(request: HttpRequest) {
			return handler(request);
		},
	};
}

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
				request: vi.fn(() => of(new AngularHttpResponse({ status: 200 }))),
			},
		},
	];
}

describe("SessionContextClient Angular adapter", () => {
	it("bridges client signals and convenience methods", async () => {
		const requests: HttpRequest[] = [];
		const transport = createTestTransport((request) => {
			requests.push(request);
			if (request.url.endsWith("/user-info")) {
				return {
					status: 200,
					headers: {},
					body: {
						subject: "session-user-1",
						display_name: "Alice",
					},
				};
			}
			return { status: 200, headers: {}, body: {} };
		});
		const injector = Injector.create({
			providers: [
				...provideAngularEnvironmentDeps(),
				provideEnvironmentProvider({
					provide: TRANSPORT_TRAIT_TOKEN,
					useValue: transport,
				}),
				provideEnvironment({
					createBaseEnvironment: createEnvironmentForTest,
					transport,
				}),
				{
					provide: DestroyRef,
					useValue: {
						destroyed: false,
						onDestroy() {
							return () => {};
						},
					} satisfies DestroyRef,
				},
				...provideSessionContext({
					config: { baseUrl: "https://auth.example.com" },
				}),
			],
		});
		const client = injector.get(SESSION_CONTEXT_CLIENT);

		await client.refresh();

		expect(client.sessionSnapshot.get()).toEqual({
			status: "resolved",
			value: expect.objectContaining({
				principal: expect.objectContaining({ displayName: "Alice" }),
			}),
		});
		expect(client.isAuthenticated.value.get()).toBe(true);

		await client.logout();
		expect(requests).toContainEqual(
			expect.objectContaining({
				method: "POST",
				url: "https://auth.example.com/auth/session/logout",
			}),
		);
		expect(client.sessionSnapshot.get()).toEqual({
			status: "resolved",
			value: null,
		});
	});

	it("provideSessionContext maps one core client into Angular DI", async () => {
		const requests: HttpRequest[] = [];
		const transport = createTestTransport((request) => {
			requests.push(request);
			return {
				status: 401,
				headers: {},
			};
		});
		const injector = Injector.create({
			providers: [
				...provideAngularEnvironmentDeps(),
				provideEnvironmentProvider({
					provide: TRANSPORT_TRAIT_TOKEN,
					useValue: transport,
				}),
				provideEnvironment({
					createBaseEnvironment: createEnvironmentForTest,
					transport,
				}),
				{
					provide: DestroyRef,
					useValue: {
						destroyed: false,
						onDestroy() {
							return () => {};
						},
					} satisfies DestroyRef,
				},
				...provideSessionContext({
					config: {
						baseUrl: "https://auth.example.com",
						autoStart: true,
					},
				}),
			],
		});

		const client = injector.get(SESSION_CONTEXT_CLIENT);

		await client.sessionResource.whenValue();
		expect(requests).toContainEqual(
			expect.objectContaining({
				url: "https://auth.example.com/auth/session/user-info",
			}),
		);
	});
});
