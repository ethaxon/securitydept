import {
	ClientErrorKind,
	type CreateFoundationEnvironmentOptions,
	createFoundationEnvironment,
	createInMemoryRecordStore,
	createRootSpan,
	createSecuritydeptDestroyRef,
	createTracing,
	ResourceStatus,
	SecuritydeptDestroyRef,
	UriReferenceString,
} from "@securitydept/client";
import {
	createTimeForTest,
	createTransportForTest,
} from "@securitydept/client/test";
import {
	BackendOidcModeClient,
	type BackendOidcModeClientConfig,
} from "@securitydept/token-set-context-client/backend-oidc-mode";
import { TOKEN_SET_CLIENT_REGISTRY } from "@securitydept/token-set-context-client-react";
import { describe, expect, it, vi } from "vitest";
import { AuthEntryKind } from "../api/entries";
import {
	assessPropagationProbeResult,
	createBasicEntryWithTokenSet,
	createGroupWithTokenSet,
	createTokenEntryWithTokenSet,
	DEFAULT_PROPAGATION_FORWARDER_CONFIG_SNIPPET,
	DEFAULT_PROPAGATION_HEADER_NAME,
	DEFAULT_PROPAGATION_PROBE_PATH,
	listEntriesWithTokenSet,
	listGroupsWithTokenSet,
	probeForwardAuthBoundaryWithTokenSet,
	probeForwardAuthWithBasicEntry,
	probeForwardAuthWithEntryToken,
	probePropagationRouteWithTokenSet,
} from "../api/tokenSet";
import { provideAuthService } from "../auth/auth.service";
import { TOKEN_SET_FRONTEND_MODE_CONFIG } from "../auth/token-set/config";

function createJsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function callbackParameters(fragment: string): Record<string, string> {
	const parameters = new URLSearchParams(fragment);
	const result: Record<string, string> = {};
	parameters.forEach((value, key) => {
		result[key] = value;
	});
	return result;
}

function createPageRouter(href: string) {
	const currentUrl = UriReferenceString.parse(href);
	return {
		currentUrl() {
			return currentUrl;
		},
		canNavigate() {
			return true;
		},
		async navigate() {},
	};
}

function createTokenSetTransport() {
	return createTransportForTest().on(
		(request) => request.url.endsWith("/metadata/redeem"),
		() => ({
			status: 200,
			headers: {},
			body: {
				metadata: {
					principal: {
						subject: "user-1",
						displayName: "Alice",
					},
				},
			},
		}),
	);
}

type BackendOidcModeTestClientOptions = Omit<
	BackendOidcModeClientConfig,
	"baseUrl"
> & {
	baseUrl?: string;
} & CreateFoundationEnvironmentOptions;

function createBackendOidcModeTestClient(
	options: BackendOidcModeTestClientOptions,
) {
	const {
		baseUrl,
		defaultPostAuthRedirectUri,
		refresh,
		persistence,
		id,
		autoStart,
		loginPath,
		refreshPath,
		metadataRedeemPath,
		userInfoPath,
		tracing,
		...environmentOptions
	} = options;

	return new BackendOidcModeClient(
		{
			baseUrl: baseUrl ?? "",
			defaultPostAuthRedirectUri,
			refresh,
			persistence,
			id,
			autoStart,
			loginPath,
			refreshPath,
			metadataRedeemPath,
			userInfoPath,
		},
		{
			environment: createFoundationEnvironment({
				...environmentOptions,
				tracing: tracing ?? createTracing(),
			}),
		},
	);
}

describe("token-set browser flow", () => {
	it("composes the frontend-mode config endpoint from the current WebUI URL", async () => {
		vi.resetModules();
		vi.restoreAllMocks();
		const fetch = vi.fn<typeof globalThis.fetch>(async () =>
			createJsonResponse(200, {
				clientId: "webui-frontend-mode",
				redirectUrl: "https://app.example.com/auth/callback",
				issuerUrl: "https://issuer.example.com",
				authorizationEndpoint: "https://issuer.example.com/authorize",
				tokenEndpoint: "https://issuer.example.com/token",
				generatedAt: Date.parse("2026-01-01T00:00:00Z"),
			}),
		);
		vi.stubGlobal("fetch", fetch);

		const environment = createFoundationEnvironment({
			router: createPageRouter("https://app.example.com/"),
			providers: [
				...provideAuthService(),
				{
					provide: SecuritydeptDestroyRef,
					useValue: createSecuritydeptDestroyRef(),
				},
			],
		});
		const initializedRecord = await environment.injector
			.get(TOKEN_SET_CLIENT_REGISTRY)
			.clientRecordFor(TOKEN_SET_FRONTEND_MODE_CONFIG.clientKey, {
				initialize: true,
			});

		expect(initializedRecord.client).toMatchObject({
			config: {
				clientId: "webui-frontend-mode",
				redirectUri:
					"https://app.example.com/auth/token-set/frontend-mode/callback",
			},
		});
		expect(initializedRecord.client.authResource.snapshot.get()).toEqual({
			status: ResourceStatus.Resolved,
			value: null,
		});
		const requestedUrl = new URL(
			fetch.mock.calls[0]![0].toString(),
			"https://app.example.com",
		);
		expect(requestedUrl.pathname).toBe(
			"/api/auth/token-set/frontend-mode/config",
		);
		expect(requestedUrl.searchParams.get("redirect_uri")).toBe(
			"https://app.example.com/auth/token-set/frontend-mode/callback",
		);
	});

	it("loads groups through the authorized WebUI API path", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const time = createTimeForTest({
			initialNow: Date.parse("2026-01-01T00:00:00Z"),
		});
		const transport = createTokenSetTransport()
			.on(
				(request) => request.url.endsWith("/refresh"),
				() => ({
					status: 200,
					headers: {},
					body: {
						access_token: "refreshed-at",
						refresh_token: "refreshed-rt",
						expires_at: "2026-01-01T00:07:00Z",
					},
				}),
			)
			.on(
				(request) => request.url.endsWith("/api/groups"),
				(request) => {
					expect(request.headers.authorization).toBe("Bearer seed-at");
					return {
						status: 200,
						headers: {},
						body: [
							{
								id: "group-1",
								name: "Admins",
							},
						],
					};
				},
			);
		const client = createBackendOidcModeTestClient({
			span: createRootSpan(),
			persistentStorage,
			sessionStorage,
			transport,
			time,
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
			refresh: { tokenFreshness: { refreshWindowMs: 60_000 } },
		});

		await client.handleCallback(
			callbackParameters(
				"access_token=seed-at&id_token=seed-idt&refresh_token=seed-rt&expires_at=2026-01-01T00%3A02%3A00Z&metadata_redemption_id=meta-6",
			),
		);
		await expect(
			listGroupsWithTokenSet(client, { transport }),
		).resolves.toEqual([
			{
				id: "group-1",
				name: "Admins",
			},
		]);
	});

	it("loads entries through the authorized WebUI API path", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const time = createTimeForTest({
			initialNow: Date.parse("2026-01-01T00:00:00Z"),
		});
		const transport = createTokenSetTransport()
			.on(
				(request) => request.url.endsWith("/refresh"),
				() => ({
					status: 200,
					headers: {},
					body: {
						access_token: "entries-at",
						refresh_token: "entries-rt",
						expires_at: "2026-01-01T00:07:00Z",
					},
				}),
			)
			.on(
				(request) => request.url.endsWith("/api/entries"),
				(request) => {
					expect(request.headers.authorization).toBe("Bearer seed-at");
					return {
						status: 200,
						headers: {},
						body: [
							{
								id: "entry-1",
								name: "Ops Token",
								kind: AuthEntryKind.Token,
								group_ids: ["group-1"],
								created_at: "2026-01-01T00:00:00Z",
								updated_at: "2026-01-01T00:00:00Z",
							},
						],
					};
				},
			);
		const client = createBackendOidcModeTestClient({
			span: createRootSpan(),
			persistentStorage,
			sessionStorage,
			transport,
			time,
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
			refresh: { tokenFreshness: { refreshWindowMs: 60_000 } },
		});

		await client.handleCallback(
			callbackParameters(
				"access_token=seed-at&id_token=seed-idt&refresh_token=seed-rt&expires_at=2026-01-01T00%3A02%3A00Z&metadata_redemption_id=meta-7",
			),
		);
		await expect(
			listEntriesWithTokenSet(client, { transport }),
		).resolves.toEqual([
			{
				id: "entry-1",
				name: "Ops Token",
				kind: AuthEntryKind.Token,
				group_ids: ["group-1"],
				created_at: "2026-01-01T00:00:00Z",
				updated_at: "2026-01-01T00:00:00Z",
			},
		]);
	});

	it("creates a token entry and reloads WebUI entries", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const time = createTimeForTest({
			initialNow: Date.parse("2026-01-01T00:00:00Z"),
		});
		const transport = createTokenSetTransport()
			.on(
				(request) => request.url.endsWith("/refresh"),
				() => ({
					status: 200,
					headers: {},
					body: {
						access_token: "mutation-at",
						refresh_token: "mutation-rt",
						expires_at: "2026-01-01T00:07:00Z",
					},
				}),
			)
			.on(
				(request) => request.url.endsWith("/api/entries/token"),
				(request) => {
					expect(request.headers.authorization).toBe("Bearer seed-at");
					expect(request.body).toBe(
						'{"name":"Ops Robot","group_ids":["group-1"]}',
					);
					return {
						status: 200,
						headers: {},
						body: {
							entry: {
								id: "entry-2",
								name: "Ops Robot",
								kind: AuthEntryKind.Token,
								group_ids: ["group-1"],
								created_at: "2026-01-01T00:01:00Z",
								updated_at: "2026-01-01T00:01:00Z",
							},
							token: "group-token-1",
						},
					};
				},
			)
			.on(
				(request) => request.url.endsWith("/api/entries"),
				(request) => {
					expect(request.headers.authorization).toBe("Bearer seed-at");
					return {
						status: 200,
						headers: {},
						body: [
							{
								id: "entry-2",
								name: "Ops Robot",
								kind: AuthEntryKind.Token,
								group_ids: ["group-1"],
								created_at: "2026-01-01T00:01:00Z",
								updated_at: "2026-01-01T00:01:00Z",
							},
						],
					};
				},
			);
		const client = createBackendOidcModeTestClient({
			span: createRootSpan(),
			persistentStorage,
			sessionStorage,
			transport,
			time,
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
			refresh: { tokenFreshness: { refreshWindowMs: 60_000 } },
		});

		await client.handleCallback(
			callbackParameters(
				"access_token=seed-at&id_token=seed-idt&refresh_token=seed-rt&expires_at=2026-01-01T00%3A02%3A00Z&metadata_redemption_id=meta-8",
			),
		);
		await expect(
			createTokenEntryWithTokenSet(
				client,
				{
					name: "Ops Robot",
					group_ids: ["group-1"],
				},
				{ transport },
			),
		).resolves.toEqual({
			entry: {
				id: "entry-2",
				name: "Ops Robot",
				kind: AuthEntryKind.Token,
				group_ids: ["group-1"],
				created_at: "2026-01-01T00:01:00Z",
				updated_at: "2026-01-01T00:01:00Z",
			},
			token: "group-token-1",
		});

		await expect(
			listEntriesWithTokenSet(client, { transport }),
		).resolves.toEqual([
			{
				id: "entry-2",
				name: "Ops Robot",
				kind: AuthEntryKind.Token,
				group_ids: ["group-1"],
				created_at: "2026-01-01T00:01:00Z",
				updated_at: "2026-01-01T00:01:00Z",
			},
		]);
	});

	it("creates a basic entry and reloads WebUI entries", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const time = createTimeForTest({
			initialNow: Date.parse("2026-01-01T00:00:00Z"),
		});
		const transport = createTokenSetTransport()
			.on(
				(request) => request.url.endsWith("/refresh"),
				() => ({
					status: 200,
					headers: {},
					body: {
						access_token: "basic-at",
						refresh_token: "basic-rt",
						expires_at: "2026-01-01T00:07:00Z",
					},
				}),
			)
			.on(
				(request) => request.url.endsWith("/api/entries/basic"),
				(request) => {
					expect(request.headers.authorization).toBe("Bearer seed-at");
					expect(request.body).toBe(
						'{"name":"Ops Basic","username":"ops","password":"secret","group_ids":["group-1"]}',
					);
					return {
						status: 200,
						headers: {},
						body: {
							entry: {
								id: "entry-3",
								name: "Ops Basic",
								kind: AuthEntryKind.Basic,
								username: "ops",
								group_ids: ["group-1"],
								created_at: "2026-01-01T00:02:00Z",
								updated_at: "2026-01-01T00:02:00Z",
							},
						},
					};
				},
			)
			.on(
				(request) => request.url.endsWith("/api/entries"),
				(request) => {
					expect(request.headers.authorization).toBe("Bearer seed-at");
					return {
						status: 200,
						headers: {},
						body: [
							{
								id: "entry-3",
								name: "Ops Basic",
								kind: AuthEntryKind.Basic,
								username: "ops",
								group_ids: ["group-1"],
								created_at: "2026-01-01T00:02:00Z",
								updated_at: "2026-01-01T00:02:00Z",
							},
						],
					};
				},
			);
		const client = createBackendOidcModeTestClient({
			span: createRootSpan(),
			persistentStorage,
			sessionStorage,
			transport,
			time,
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
			refresh: { tokenFreshness: { refreshWindowMs: 60_000 } },
		});

		await client.handleCallback(
			callbackParameters(
				"access_token=seed-at&id_token=seed-idt&refresh_token=seed-rt&expires_at=2026-01-01T00%3A02%3A00Z&metadata_redemption_id=meta-9",
			),
		);
		await expect(
			createBasicEntryWithTokenSet(
				client,
				{
					name: "Ops Basic",
					username: "ops",
					password: "secret",
					group_ids: ["group-1"],
				},
				{ transport },
			),
		).resolves.toEqual({
			entry: {
				id: "entry-3",
				name: "Ops Basic",
				kind: AuthEntryKind.Basic,
				username: "ops",
				group_ids: ["group-1"],
				created_at: "2026-01-01T00:02:00Z",
				updated_at: "2026-01-01T00:02:00Z",
			},
		});

		await expect(
			listEntriesWithTokenSet(client, { transport }),
		).resolves.toEqual([
			{
				id: "entry-3",
				name: "Ops Basic",
				kind: AuthEntryKind.Basic,
				username: "ops",
				group_ids: ["group-1"],
				created_at: "2026-01-01T00:02:00Z",
				updated_at: "2026-01-01T00:02:00Z",
			},
		]);
	});

	it("creates a group and reloads WebUI groups and entries", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const time = createTimeForTest({
			initialNow: Date.parse("2026-01-01T00:00:00Z"),
		});
		const transport = createTokenSetTransport()
			.on(
				(request) => request.url.endsWith("/refresh"),
				() => ({
					status: 200,
					headers: {},
					body: {
						access_token: "group-at",
						refresh_token: "group-rt",
						expires_at: "2026-01-01T00:07:00Z",
					},
				}),
			)
			.on(
				(request) =>
					request.url.endsWith("/api/groups") && request.method === "POST",
				(request) => {
					expect(request.headers.authorization).toBe("Bearer seed-at");
					expect(request.body).toBe(
						'{"name":"Ops Team","entry_ids":["entry-2","entry-3"]}',
					);
					return {
						status: 200,
						headers: {},
						body: {
							id: "group-2",
							name: "Ops Team",
						},
					};
				},
			)
			.on(
				(request) =>
					request.url.endsWith("/api/groups") && request.method === "GET",
				(request) => {
					expect(request.headers.authorization).toBe("Bearer seed-at");
					return {
						status: 200,
						headers: {},
						body: [
							{
								id: "group-2",
								name: "Ops Team",
							},
						],
					};
				},
			)
			.on(
				(request) => request.url.endsWith("/api/entries"),
				(request) => {
					expect(request.headers.authorization).toBe("Bearer seed-at");
					return {
						status: 200,
						headers: {},
						body: [
							{
								id: "entry-2",
								name: "Ops Robot",
								kind: AuthEntryKind.Token,
								group_ids: ["group-2"],
								created_at: "2026-01-01T00:01:00Z",
								updated_at: "2026-01-01T00:03:00Z",
							},
							{
								id: "entry-3",
								name: "Ops Basic",
								kind: AuthEntryKind.Basic,
								username: "ops",
								group_ids: ["group-2"],
								created_at: "2026-01-01T00:02:00Z",
								updated_at: "2026-01-01T00:03:00Z",
							},
						],
					};
				},
			);
		const client = createBackendOidcModeTestClient({
			span: createRootSpan(),
			persistentStorage,
			sessionStorage,
			transport,
			time,
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
			refresh: { tokenFreshness: { refreshWindowMs: 60_000 } },
		});

		await client.handleCallback(
			callbackParameters(
				"access_token=seed-at&id_token=seed-idt&refresh_token=seed-rt&expires_at=2026-01-01T00%3A02%3A00Z&metadata_redemption_id=meta-10",
			),
		);
		await expect(
			createGroupWithTokenSet(
				client,
				{
					name: "Ops Team",
					entry_ids: ["entry-2", "entry-3"],
				},
				{ transport },
			),
		).resolves.toEqual({
			id: "group-2",
			name: "Ops Team",
		});

		await expect(
			listGroupsWithTokenSet(client, { transport }),
		).resolves.toEqual([
			{
				id: "group-2",
				name: "Ops Team",
			},
		]);
		await expect(
			listEntriesWithTokenSet(client, { transport }),
		).resolves.toEqual([
			{
				id: "entry-2",
				name: "Ops Robot",
				kind: AuthEntryKind.Token,
				group_ids: ["group-2"],
				created_at: "2026-01-01T00:01:00Z",
				updated_at: "2026-01-01T00:03:00Z",
			},
			{
				id: "entry-3",
				name: "Ops Basic",
				kind: AuthEntryKind.Basic,
				username: "ops",
				group_ids: ["group-2"],
				created_at: "2026-01-01T00:02:00Z",
				updated_at: "2026-01-01T00:03:00Z",
			},
		]);
	});

	it("bridges AbortSignal into the token-set request cancellation contract through the shared web helper", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const time = createTimeForTest({
			initialNow: Date.parse("2026-01-01T00:00:00Z"),
		});
		const controller = new AbortController();
		let seenCancelledState = false;
		let seenReason: unknown;
		const transport = createTransportForTest().on(
			(request) => request.url.endsWith("/api/groups"),
			(request) => {
				controller.abort("react-query");
				seenCancelledState =
					request.cancellationToken?.isCancellationRequested ?? false;
				seenReason = request.cancellationToken?.reason;
				request.cancellationToken?.throwIfCancellationRequested();
				return {
					status: 200,
					headers: {},
					body: [],
				};
			},
		);
		const client = createBackendOidcModeTestClient({
			span: createRootSpan(),
			persistentStorage,
			sessionStorage,
			transport,
			time,
		});

		await client.handleCallback(
			callbackParameters(
				"access_token=abort-at&id_token=abort-idt&refresh_token=abort-rt&expires_at=2026-01-01T00%3A05%3A00Z",
			),
		);

		await expect(
			listGroupsWithTokenSet(client, {
				transport,
				abortSignal: controller.signal,
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Cancelled,
			code: "client.cancelled",
		});
		expect(seenCancelledState).toBe(true);
		expect(seenReason).toBe("react-query");
	});

	it("probes the forward-auth boundary without treating 401 as a transport failure", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const time = createTimeForTest({
			initialNow: Date.parse("2026-01-01T00:00:00Z"),
		});
		const transport = createTokenSetTransport().on(
			(request) => request.url.endsWith("/api/forwardauth/traefik/Admins"),
			(request) => {
				expect(request.headers.authorization).toBe("Bearer callback-at");
				return {
					status: 401,
					headers: {
						"www-authenticate":
							'Basic realm="securitydept", Bearer realm="securitydept"',
					},
				};
			},
		);
		const client = createBackendOidcModeTestClient({
			span: createRootSpan(),
			persistentStorage,
			sessionStorage,
			transport,
			time,
		});

		await client.handleCallback(
			callbackParameters(
				"access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&expires_at=2026-01-01T00%3A05%3A00Z",
			),
		);

		await expect(
			probeForwardAuthBoundaryWithTokenSet(client, "Admins", { transport }),
		).resolves.toEqual({
			status: 401,
			authenticated: false,
			authorizationChallenge:
				'Basic realm="securitydept", Bearer realm="securitydept"',
			authenticatedEntry: null,
		});
	});

	it("uses the generated entry token to satisfy the forward-auth route", async () => {
		const transport = createTransportForTest().on(
			(request) => request.url.endsWith("/api/forwardauth/traefik/Admins"),
			(request) => {
				expect(request.headers.authorization).toBe("Bearer group-token-1");
				return {
					status: 200,
					headers: {
						"x-auth-user": "Ops Robot",
					},
				};
			},
		);

		await expect(
			probeForwardAuthWithEntryToken("group-token-1", "Admins", { transport }),
		).resolves.toEqual({
			status: 200,
			authenticated: true,
			authorizationChallenge: null,
			authenticatedEntry: "Ops Robot",
		});
	});

	it("uses the generated basic credential to satisfy the forward-auth route", async () => {
		const transport = createTransportForTest().on(
			(request) => request.url.endsWith("/api/forwardauth/traefik/Admins"),
			(request) => {
				expect(request.headers.authorization).toBe("Basic b3BzOnNlY3JldA==");
				return {
					status: 200,
					headers: {
						"x-auth-user": "Ops Basic",
					},
				};
			},
		);

		await expect(
			probeForwardAuthWithBasicEntry("ops", "secret", "Admins", {
				transport,
			}),
		).resolves.toEqual({
			status: 200,
			authenticated: true,
			authorizationChallenge: null,
			authenticatedEntry: "Ops Basic",
		});
	});

	it("probes the propagation route with dashboard bearer and explicit directive", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const time = createTimeForTest({
			initialNow: Date.parse("2026-01-01T00:00:00Z"),
		});
		const transport = createTokenSetTransport().on(
			(request) => request.url.endsWith(DEFAULT_PROPAGATION_PROBE_PATH),
			(request) => {
				expect(request.headers.authorization).toBe("Bearer callback-at");
				expect(request.headers[DEFAULT_PROPAGATION_HEADER_NAME]).toBe(
					"by=dashboard;for=local-health;host=localhost:7021;proto=http",
				);
				return {
					status: 200,
					headers: {},
					body: {
						status: "ok",
					},
				};
			},
		);
		const client = createBackendOidcModeTestClient({
			span: createRootSpan(),
			persistentStorage,
			sessionStorage,
			transport,
			time,
		});

		await client.handleCallback(
			callbackParameters(
				"access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&expires_at=2026-01-01T00%3A05%3A00Z",
			),
		);

		await expect(
			probePropagationRouteWithTokenSet(
				client,
				"by=dashboard;for=local-health;host=localhost:7021;proto=http",
				{ transport },
			),
		).resolves.toEqual({
			status: 200,
			body: {
				status: "ok",
			},
		});
	});

	it("assesses a 404 propagation probe as missing forwarder config", () => {
		expect(
			assessPropagationProbeResult(404, {
				message: "Not Found",
			}),
		).toEqual({
			summary:
				"The current environment does not expose `/api/propagation/*`, so the dashboard bearer and propagation directive reached a valid route shape but no mounted forwarder.",
			configStatus:
				"The checked-in server config currently omits a usable propagation-forwarder setup. Mount `[propagation_forwarder]` and allow the downstream origin under `[token_set_context.token_propagation.destination_policy]` before expecting real forwarding behavior.",
			recommendedConfigSnippet: DEFAULT_PROPAGATION_FORWARDER_CONFIG_SNIPPET,
		});
	});

	it("assesses a 200 propagation probe as a mounted usable forwarder path", () => {
		expect(
			assessPropagationProbeResult(200, {
				status: "ok",
			}),
		).toEqual({
			summary:
				"Propagation route is mounted and successfully forwarded the dashboard bearer to the configured downstream target.",
			configStatus:
				"The current config is sufficient for the same-server healthcheck path. Keep this probe in app space because the route path, target origin, and policy remain product-specific.",
			recommendedConfigSnippet: null,
		});
	});

	it("assesses a mounted propagation error as policy-stage feedback instead of route absence", () => {
		expect(
			assessPropagationProbeResult(400, {
				error: {
					message:
						"The propagation header is invalid: propagation directive requires `host`",
				},
			}),
		).toEqual({
			summary:
				"Propagation route returned HTTP 400: The propagation header is invalid: propagation directive requires `host`",
			configStatus:
				"The route is mounted, so the remaining issue is propagation policy, directive validity, or downstream reachability rather than bearer/header wiring.",
			recommendedConfigSnippet: null,
		});
	});
});
