import {
	type BaseTransportTrait,
	ClientError,
	ClientErrorKind,
	createCancellationTokenSource,
	type HttpRequest,
	type HttpResponse,
	isClientErrorEvent,
	type RouterTrait,
	SpanSharedAttributeName,
	type TracingEvent,
	UriReferenceString,
} from "@securitydept/client";
import { createEnvironmentForTest } from "@securitydept/client/test";
import { filter, from } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { SessionContextClient } from "../client";
import { SessionContextSource } from "../error";
import { SessionContextEventType } from "../types";

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
	it("emits non-replayed typed failure events", async () => {
		const client = SessionContextClient.fromEnvironmentConfig({
			config: { baseUrl: "https://api.example.com" },
			environment: createEnvironmentForTest({
				transport: createTestTransport(() => ({
					status: 500,
					headers: {},
					body: null,
				})),
			}),
		});
		const errors: ClientError[] = [];
		from(client.events)
			.pipe(filter(isClientErrorEvent))
			.subscribe((event) => errors.push(event.error));

		let rejected: unknown;
		try {
			await client.refresh();
		} catch (error) {
			rejected = error;
		}

		expect(errors).toHaveLength(1);
		expect(errors[0]).toBe(rejected);
		expect(
			errors[0]?.spanContext?.at(-1)?.attributes[
				SpanSharedAttributeName.OperationName
			],
		).toBe("session_context.refresh");
		const lateEvents: unknown[] = [];
		client.events.subscribe({ next: (event) => lateEvents.push(event) });
		expect(lateEvents).toEqual([]);
	});

	it("links refresh cancellation to the client lifecycle token", async () => {
		const execute = vi.fn(async () => ({ status: 200, headers: {} }));
		const client = SessionContextClient.fromEnvironmentConfig({
			config: { baseUrl: "https://api.example.com" },
			environment: createEnvironmentForTest({ transport: { execute } }),
		});
		const cancellation = createCancellationTokenSource();
		const reason = new Error("cancel session refresh");
		cancellation.cancel(reason);

		await expect(
			client.refresh({ cancellationToken: cancellation.token }),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Cancelled,
			code: "client.cancelled",
			cause: reason,
		});
		expect(execute).not.toHaveBeenCalled();
	});

	it("normalizes the Rust session /auth/session/user-info payload into SessionInfo", async () => {
		const rustSessionUserInfoResponse = {
			subject: "session-user-1",
			display_name: "Alice",
			picture: "https://example.com/alice.png",
			issuer: "https://issuer.example.com",
			claims: { role: "admin" },
		};
		const client = SessionContextClient.fromEnvironmentConfig({
			config: { baseUrl: "https://api.example.com" },
			environment: createEnvironmentForTest({
				transport: createTestTransport(() => ({
					status: 200,
					headers: {},
					body: rustSessionUserInfoResponse,
				})),
			}),
		});

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
		expect(await client.sessionResource.whenValue()).toEqual(result);
		expect(await client.isAuthenticated.whenValue()).toBe(true);
	});

	it("commits unauthenticated state for 401 and 403", async () => {
		for (const status of [401, 403]) {
			const client = SessionContextClient.fromEnvironmentConfig({
				config: { baseUrl: "https://api.example.com" },
				environment: createEnvironmentForTest({
					transport: createTestTransport(() => ({
						status,
						headers: {},
					})),
				}),
			});

			await expect(client.refresh()).resolves.toBeNull();
			expect(await client.sessionResource.whenValue()).toBeNull();
			expect(await client.isAuthenticated.whenValue()).toBe(false);
		}
	});

	it("records failures in the session snapshot", async () => {
		const client = SessionContextClient.fromEnvironmentConfig({
			config: { baseUrl: "https://api.example.com" },
			environment: createEnvironmentForTest({
				transport: createTestTransport(() => ({
					status: 500,
					headers: {},
					body: { message: "Internal Server Error" },
				})),
			}),
		});

		await expect(client.refresh()).rejects.toBeInstanceOf(ClientError);
		expect(client.sessionSnapshot.get()).toMatchObject({
			status: "loading_error",
			error: { kind: ClientErrorKind.Server },
		});
	});

	it("rejects the legacy session /auth/session/user-info payload without subject", async () => {
		const client = SessionContextClient.fromEnvironmentConfig({
			config: { baseUrl: "https://api.example.com" },
			environment: createEnvironmentForTest({
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
		});

		await expect(client.refresh()).rejects.toMatchObject({
			name: "ClientError",
			kind: ClientErrorKind.Protocol,
			code: "session.invalid_user_info_payload",
			source: SessionContextSource.SessionContext,
		});
	});

	it("executes logout against the configured endpoint and clears session", async () => {
		const requests: HttpRequest[] = [];
		const client = SessionContextClient.fromEnvironmentConfig({
			config: { baseUrl: "https://api.example.com" },
			environment: createEnvironmentForTest({
				transport: createTestTransport((request) => {
					requests.push(request);
					return {
						status: 200,
						headers: {},
						body: {},
					};
				}),
			}),
		});

		await client.logout();

		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			url: "https://api.example.com/auth/session/logout",
			method: "POST",
		});
		expect(await client.sessionResource.whenValue()).toBeNull();
	});

	it("loginWithRedirect navigates with an explicit post-auth redirect", async () => {
		const { router, navigations } = createTestRouter(
			"https://app.example.com/dashboard#state",
		);
		const client = SessionContextClient.fromEnvironmentConfig({
			config: { baseUrl: "https://api.example.com" },
			environment: createEnvironmentForTest({
				router,
			}),
		});

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
		const client = SessionContextClient.fromEnvironmentConfig({
			config: { baseUrl: "https://api.example.com" },
			environment: createEnvironmentForTest({ router }),
		});

		await client.loginWithRedirect();

		expect(navigations).toHaveLength(1);
		expect(navigations[0]?.url).toBe(
			"https://api.example.com/auth/session/login",
		);
	});

	it("emits session events and operation tracing", async () => {
		const events: unknown[] = [];
		const tracingEvents: TracingEvent[] = [];
		const client = SessionContextClient.fromEnvironmentConfig({
			config: { baseUrl: "https://api.example.com" },
			environment: createEnvironmentForTest({
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
		});
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
