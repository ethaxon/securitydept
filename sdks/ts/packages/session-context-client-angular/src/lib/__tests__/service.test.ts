import type {
	HttpRequest,
	HttpResponse,
	HttpTransport,
} from "@securitydept/client";
import { createInMemoryRecordStore } from "@securitydept/client";
import { createWebClientEnvironment } from "@securitydept/client/web";
import {
	SessionContextClient,
	SessionContextController,
} from "@securitydept/session-context-client";
import {
	provideSessionContext,
	SessionContextService,
} from "@securitydept/session-context-client-angular";
import { describe, expect, it } from "vitest";

function createTestTransport(
	handler: (request: HttpRequest) => HttpResponse,
): HttpTransport {
	return {
		async execute(request: HttpRequest) {
			return handler(request);
		},
	};
}

describe("SessionContextService", () => {
	it("reuses the shared session convenience story for redirect intent and logout cleanup", async () => {
		const requests: HttpRequest[] = [];
		const transport = createTestTransport((request) => {
			requests.push(request);
			if (request.url.endsWith("/user-info")) {
				return {
					status: 401,
					headers: {},
				};
			}

			return {
				status: 200,
				headers: {},
				body: {},
			};
		});
		const client = new SessionContextClient(
			{ baseUrl: "https://auth.example.com" },
			{ sessionStore: createInMemoryRecordStore() },
		);
		const controller = new SessionContextController({ client, transport });
		const service = new SessionContextService(controller);
		expect(service.client.loginUrl("/manual")).toBe(
			"https://auth.example.com/auth/session/login?post_auth_redirect_uri=%2Fmanual",
		);
		expect(requests).toEqual([]);

		await service.refresh();
		expect(requests).toContainEqual(
			expect.objectContaining({
				method: "GET",
				url: "https://auth.example.com/auth/session/user-info",
			}),
		);

		await service.rememberPostAuthRedirect("/entries?tab=all");
		expect(await service.resolveLoginUrl()).toBe(
			"https://auth.example.com/auth/session/login?post_auth_redirect_uri=%2Fentries%3Ftab%3Dall",
		);

		await service.rememberPostAuthRedirect("/entries/new");
		await service.logout();

		expect(requests).toContainEqual(
			expect.objectContaining({
				method: "POST",
				url: "https://auth.example.com/auth/session/logout",
			}),
		);
		expect(await service.client.loadPendingLoginRedirect()).toBeNull();
		expect(service.session()).toBeNull();
		expect(service.loading()).toBe(false);
	});

	it("provideSessionContext derives controller from one environment and supports explicit initial refresh", async () => {
		const requests: HttpRequest[] = [];
		const transport = createTestTransport((request) => {
			requests.push(request);
			if (request.url.endsWith("/user-info")) {
				return {
					status: 401,
					headers: {},
				};
			}

			return {
				status: 200,
				headers: {},
				body: {},
			};
		});
		const sessionStore = createInMemoryRecordStore();
		const environment = createWebClientEnvironment({
			transport,
			sessionStore,
		});

		const providers = provideSessionContext({
			config: { baseUrl: "https://auth.example.com" },
			environment,
			initialRefresh: true,
		});
		const [
			clientProvider,
			controllerProvider,
			transportProvider,
			serviceProvider,
		] = providers;
		if (
			!clientProvider ||
			typeof clientProvider !== "object" ||
			!("useValue" in clientProvider)
		) {
			throw new Error("Expected client useValue provider");
		}
		if (
			!controllerProvider ||
			typeof controllerProvider !== "object" ||
			!("useValue" in controllerProvider)
		) {
			throw new Error("Expected controller useValue provider");
		}
		if (
			!transportProvider ||
			typeof transportProvider !== "object" ||
			!("useValue" in transportProvider)
		) {
			throw new Error("Expected transport useValue provider");
		}
		if (
			!serviceProvider ||
			typeof serviceProvider !== "object" ||
			!("useFactory" in serviceProvider)
		) {
			throw new Error("Expected SessionContextService factory provider");
		}

		const client = clientProvider.useValue as SessionContextClient;
		const controller = controllerProvider.useValue as SessionContextController;
		const providedTransport = transportProvider.useValue as HttpTransport;
		const service = serviceProvider.useFactory(
			controller,
		) as SessionContextService;

		expect(providedTransport).toBe(environment.transport);
		expect(controller.client).toBe(client);
		await service.rememberPostAuthRedirect("/entries");
		expect(await client.loadPendingLoginRedirect()).toBe("/entries");

		await Promise.resolve();
		await Promise.resolve();
		expect(requests).toContainEqual(
			expect.objectContaining({
				url: "https://auth.example.com/auth/session/user-info",
			}),
		);
	});

	it("service refresh updates Angular signal and observable bridges", async () => {
		const transport = createTestTransport(() => ({
			status: 200,
			headers: {},
			body: { subject: "session-user-2", display_name: "Bob" },
		}));
		const controller = new SessionContextController({
			client: new SessionContextClient({ baseUrl: "https://auth.example.com" }),
			transport,
		});
		const service = new SessionContextService(controller);
		const observed: string[] = [];
		const subscription = service.state$.subscribe((state) => {
			observed.push(state.status);
		});

		await service.refresh();

		expect(service.session()?.principal.displayName).toBe("Bob");
		expect(service.loading()).toBe(false);
		expect(observed).toContain("authenticated");
		subscription.unsubscribe();
	});
});
