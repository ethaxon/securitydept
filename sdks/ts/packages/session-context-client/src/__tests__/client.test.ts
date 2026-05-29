import {
	type BaseTransportTrait,
	ClientError,
	ClientErrorKind,
	type HttpRequest,
	type HttpResponse,
	type RouterTrait,
	type TracingEvent,
	UriReferenceString,
	UriString,
} from "@securitydept/client";
import { describe, expect, it } from "vitest";
import { createEnvironmentForTest } from "../../../client/src/test";
import { SessionContextClient } from "../client";
import { SessionContextEventType, SessionContextSource } from "../types";

function createTestTransport(
	handler: (request: HttpRequest) => HttpResponse,
): BaseTransportTrait {
	return {
		async execute(request: HttpRequest) {
			return handler(request);
		},
	};
}

function createTestRouter(url = "https://app.example.com/current"): {
	router: RouterTrait;
	navigations: HttpRequest[];
} {
	const navigations: HttpRequest[] = [];
	return {
		router: {
			currentUrl() {
				return UriReferenceString.parse(url);
			},
			baseURI() {
				return UriString.parse(url);
			},
			navigate(request) {
				navigations.push({
					url: request.url.toString(),
					method: request.mode,
					headers: {},
					body: request,
				});
			},
		},
		navigations,
	};
}

describe("SessionContextClient", () => {
	it("normalizes the Rust session /auth/session/user-info payload into SessionInfo", async () => {
		const rustSessionUserInfoResponse = {
			subject: "session-user-1",
			display_name: "Alice",
			picture: "https://example.com/alice.png",
			issuer: "https://issuer.example.com",
			claims: { role: "admin" },
		};
		const client = new SessionContextClient(
			{ baseUrl: "https://api.example.com" },
			createEnvironmentForTest({
				transport: createTestTransport(() => ({
					status: 200,
					headers: {},
					body: rustSessionUserInfoResponse,
				})),
			}),
		);

		const result = await client.refresh();

		expect(result).toEqual({
			principal: {
				subject: rustSessionUserInfoResponse.subject,
				displayName: rustSessionUserInfoResponse.display_name,
				picture: rustSessionUserInfoResponse.picture,
				issuer: rustSessionUserInfoResponse.issuer,
				claims: rustSessionUserInfoResponse.claims,
			},
		});
		expect(await client.sessionInfo.whenValue()).toEqual(result);
		expect(await client.isAuthenticated.whenValue()).toBe(true);
	});

	it("commits unauthenticated state for 401 and 403", async () => {
		for (const status of [401, 403]) {
			const client = new SessionContextClient(
				{ baseUrl: "https://api.example.com" },
				createEnvironmentForTest({
					transport: createTestTransport(() => ({
						status,
						headers: {},
					})),
				}),
			);

			await expect(client.refresh()).resolves.toBeNull();
			expect(await client.sessionInfo.whenValue()).toBeNull();
			expect(await client.isAuthenticated.whenValue()).toBe(false);
		}
	});

	it("records failures in lastSessionError", async () => {
		const client = new SessionContextClient(
			{ baseUrl: "https://api.example.com" },
			createEnvironmentForTest({
				transport: createTestTransport(() => ({
					status: 500,
					headers: {},
					body: { message: "Internal Server Error" },
				})),
			}),
		);

		await expect(client.refresh()).rejects.toBeInstanceOf(ClientError);
		expect(client.lastSessionError.get()).toMatchObject({
			kind: ClientErrorKind.Server,
		});
	});

	it("rejects the legacy session /auth/session/user-info payload without subject", async () => {
		const client = new SessionContextClient(
			{ baseUrl: "https://api.example.com" },
			createEnvironmentForTest({
				transport: createTestTransport(() => ({
					status: 200,
					headers: {},
					body: {
						display_name: "Alice",
						picture: "https://example.com/alice.png",
						claims: { role: "admin" },
					},
				})),
			}),
		);

		await expect(client.refresh()).rejects.toMatchObject({
			name: "ClientError",
			kind: ClientErrorKind.Protocol,
			code: "session.invalid_user_info_payload",
			source: SessionContextSource.SessionContext,
		});
	});

	it("executes logout against the configured endpoint and clears session", async () => {
		const requests: HttpRequest[] = [];
		const client = new SessionContextClient(
			{ baseUrl: "https://api.example.com" },
			createEnvironmentForTest({
				transport: createTestTransport((request) => {
					requests.push(request);
					return {
						status: 200,
						headers: {},
						body: {},
					};
				}),
			}),
		);

		await client.logout();

		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			url: "https://api.example.com/auth/session/logout",
			method: "POST",
		});
		expect(await client.sessionInfo.whenValue()).toBeNull();
	});

	it("loginWithRedirect navigates with an explicit post-auth redirect", async () => {
		const { router, navigations } = createTestRouter(
			"https://app.example.com/dashboard#state",
		);
		const client = new SessionContextClient(
			{ baseUrl: "https://api.example.com" },
			createEnvironmentForTest({
				router,
			}),
		);

		await client.loginWithRedirect({
			postAuthRedirectUri: "https://app.example.com/dashboard#state",
		});

		expect(navigations).toHaveLength(1);
		expect(navigations[0]?.url).toBe(
			"https://api.example.com/auth/session/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fdashboard%23state",
		);
	});

	it("loginWithRedirect does not infer post-auth redirect from router", async () => {
		const { router, navigations } = createTestRouter(
			"https://app.example.com/dashboard#state",
		);
		const client = new SessionContextClient(
			{ baseUrl: "https://api.example.com" },
			createEnvironmentForTest({ router }),
		);

		await client.loginWithRedirect();

		expect(navigations).toHaveLength(1);
		expect(navigations[0]?.url).toBe(
			"https://api.example.com/auth/session/login",
		);
	});

	it("emits session events and operation tracing", async () => {
		const events: unknown[] = [];
		const tracingEvents: TracingEvent[] = [];
		const client = new SessionContextClient(
			{ baseUrl: "https://api.example.com" },
			createEnvironmentForTest({
				transport: createTestTransport(() => ({
					status: 401,
					headers: {},
				})),
				tracingCreateOptions: {
					subscribers: [
						{
							record(event: TracingEvent) {
								tracingEvents.push(event);
							},
						},
					],
				},
			}),
		);
		client.events.subscribe({
			next(event) {
				events.push(event);
			},
		});

		await client.refresh();

		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: SessionContextEventType.SessionRefreshStarted,
				}),
				expect.objectContaining({
					type: SessionContextEventType.SessionRefreshSucceeded,
				}),
			]),
		);
		expect(tracingEvents.map((event) => event.name)).toEqual(
			expect.arrayContaining(["operation.started", "operation.ended"]),
		);
	});
});
