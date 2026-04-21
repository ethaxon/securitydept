import type {
	HttpRequest,
	HttpResponse,
	HttpTransport,
} from "@securitydept/client";
import { createInMemoryRecordStore } from "@securitydept/client";
import { SessionContextClient } from "@securitydept/session-context-client";
import { SessionContextService } from "@securitydept/session-context-client-angular";
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
		const service = new SessionContextService(client, transport);
		expect(service.client.loginUrl("/manual")).toBe(
			"https://auth.example.com/auth/session/login?post_auth_redirect_uri=%2Fmanual",
		);

		await Promise.resolve();
		await Promise.resolve();

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
});
