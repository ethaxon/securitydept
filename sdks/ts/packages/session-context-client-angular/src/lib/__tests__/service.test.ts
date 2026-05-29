import { DestroyRef, Injector } from "@angular/core";
import {
	type BaseTransportTrait,
	type HttpRequest,
	type HttpResponse,
} from "@securitydept/client";
import { provideEnvironment } from "@securitydept/client-angular";
import {
	provideSessionContext,
	SESSION_CONTEXT_CLIENT,
	SessionContextService,
} from "@securitydept/session-context-client-angular";
import { describe, expect, it } from "vitest";
import { createEnvironmentForTest } from "../../../../client/src/test";

function createTestTransport(
	handler: (request: HttpRequest) => HttpResponse,
): BaseTransportTrait {
	return {
		async execute(request: HttpRequest) {
			return handler(request);
		},
	};
}

describe("SessionContextService", () => {
	it("bridges client signals and convenience methods", async () => {
		const requests: HttpRequest[] = [];
		const environment = createEnvironmentForTest({
			transport: createTestTransport((request) => {
				requests.push(request);
				if (request.url.endsWith("/user-info")) {
					return {
						status: 200,
						headers: {},
						body: { subject: "session-user-1", display_name: "Alice" },
					};
				}
				return { status: 200, headers: {}, body: {} };
			}),
		});
		const injector = Injector.create({
			providers: [
				provideEnvironment({ environment }),
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
		const service = injector.get(SessionContextService);

		await service.refresh();

		expect(service.sessionInfo.get()).toEqual({
			kind: "value",
			value: expect.objectContaining({
				principal: expect.objectContaining({ displayName: "Alice" }),
			}),
		});
		expect(service.isAuthenticated.get()).toEqual({
			kind: "value",
			value: true,
		});

		await service.logout();
		expect(requests).toContainEqual(
			expect.objectContaining({
				method: "POST",
				url: "https://auth.example.com/auth/session/logout",
			}),
		);
		expect(service.sessionInfo.get()).toEqual({ kind: "value", value: null });
	});

	it("provideSessionContext registers only the client and service", async () => {
		const requests: HttpRequest[] = [];
		const environment = createEnvironmentForTest({
			transport: createTestTransport((request) => {
				requests.push(request);
				return {
					status: 401,
					headers: {},
				};
			}),
		});

		const injector = Injector.create({
			providers: [
				provideEnvironment({ environment }),
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
		const service = injector.get(SessionContextService);

		await service.sessionInfo.whenValue();
		expect(service).toBe(client);
		expect(requests).toContainEqual(
			expect.objectContaining({
				url: "https://auth.example.com/auth/session/user-info",
			}),
		);
	});
});
