import {
	ClientErrorKind,
	createCancellationTokenSource,
	createInMemoryRecordStore,
	type HttpRequest,
	type HttpResponse,
	readErrorPresentationDescriptor,
	UserRecovery,
} from "@securitydept/client";
import {
	FakeClock,
	FakeScheduler,
	FakeTransport,
} from "@securitydept/test-utils";
import {
	BackendOidcModeBootstrapSource,
	bootstrapBackendOidcModeClient,
	createBackendOidcModeBrowserClient,
	createBackendOidcModeCallbackFragmentStore,
} from "@securitydept/token-set-context-client/backend-oidc-mode/web";
import { describe, expect, it, vi } from "vitest";
import { AuthEntryKind } from "../api/entries";
import {
	assessPropagationProbeResult,
	createBasicEntryWithTokenSet,
	createGroupWithTokenSet,
	createTokenEntryWithTokenSet,
	DEFAULT_PROPAGATION_HEADER_NAME,
	DEFAULT_PROPAGATION_PROBE_PATH,
	listEntriesWithTokenSet,
	listGroupsWithTokenSet,
	probeForwardAuthBoundaryWithTokenSet,
	probeForwardAuthWithBasicEntry,
	probeForwardAuthWithEntryToken,
	probePropagationRouteWithTokenSet,
} from "../api/tokenSet";

class MemoryStorage {
	private readonly data = new Map<string, string>();

	getItem(key: string): string | null {
		return this.data.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.data.set(key, value);
	}

	removeItem(key: string): void {
		this.data.delete(key);
	}

	clear(): void {
		this.data.clear();
	}
}

function createJsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function createHistoryRecorder() {
	return {
		replacedUrl: "" as string,
		replaceState(_data: unknown, _unused: string, url?: string) {
			this.replacedUrl = url ?? "";
		},
	};
}

function createTokenSetTransport() {
	return new FakeTransport().on(
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

describe("token-set browser flow", () => {
	it("maps config projection envelopes into ClientError presentation on the frontend-mode host path", async () => {
		vi.resetModules();
		vi.restoreAllMocks();
		Object.defineProperty(globalThis, "window", {
			value: {
				location: { origin: "https://app.example.com" },
				history: { replaceState() {} },
			},
			configurable: true,
			writable: true,
		});
		Object.defineProperty(globalThis, "localStorage", {
			value: new MemoryStorage(),
			configurable: true,
			writable: true,
		});
		Object.defineProperty(globalThis, "sessionStorage", {
			value: new MemoryStorage(),
			configurable: true,
			writable: true,
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				createJsonResponse(401, {
					status: 401,
					error: {
						kind: "unauthenticated",
						code: "frontend_oidc.config_projection_failed",
						message: "Sign in again to load the frontend-mode configuration.",
						recovery: UserRecovery.Reauthenticate,
						presentation: {
							code: "frontend_oidc.config_projection_failed",
							message: "Sign in again to load the frontend-mode configuration.",
							recovery: UserRecovery.Reauthenticate,
						},
					},
				}),
			),
		);

		const { getTokenSetFrontendModeClient } = await import(
			"../lib/tokenSetFrontendModeClient"
		);

		let failure: unknown;
		try {
			await getTokenSetFrontendModeClient();
		} catch (error) {
			failure = error;
		}

		expect(failure).toMatchObject({
			name: "ClientError",
			kind: ClientErrorKind.Unauthenticated,
		});

		const descriptor = readErrorPresentationDescriptor(failure, {
			fallbackTitle: "Frontend-mode action failed",
			fallbackDescription:
				"The frontend-mode reference action could not complete.",
			recoveryLinks: {
				[UserRecovery.Reauthenticate]: "/playground/token-set-frontend",
			},
			recoveryLabels: {
				[UserRecovery.Reauthenticate]: "Sign in again",
			},
		});

		expect(descriptor.title).toBe("Authentication required");
		expect(descriptor.description).toBe(
			"Sign in again to load the frontend-mode configuration.",
		);
		expect(descriptor.recovery).toBe(UserRecovery.Reauthenticate);
		expect(descriptor.primaryAction).toEqual({
			recovery: UserRecovery.Reauthenticate,
			label: "Sign in again",
			href: "/playground/token-set-frontend",
		});
	});

	it("captures callback fragments, clears the URL hash, and initializes client state", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const transport = createTokenSetTransport();
		const clock = new FakeClock(Date.parse("2026-01-01T00:00:00Z"));
		const scheduler = new FakeScheduler(clock);
		const client = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
		});
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStore,
		});
		const history = createHistoryRecorder();

		const result = await bootstrapBackendOidcModeClient(client, {
			location: {
				href: "https://app.example.com/token-set#access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-1",
				hash: "#access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-1",
			},
			history,
			callbackFragmentStore,
		});

		expect(result.source).toBe(BackendOidcModeBootstrapSource.Callback);
		expect(result.snapshot?.tokens.accessToken).toBe("callback-at");
		expect(result.snapshot?.metadata.principal?.displayName).toBe("Alice");
		expect(await callbackFragmentStore.load()).toBeNull();
		expect(history.replacedUrl).toBe("/token-set");
		expect(scheduler.pendingCount).toBe(1);
	});

	it("restores persisted token-set state when no callback fragment is pending", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const transport = createTokenSetTransport();
		const clock = new FakeClock(Date.parse("2026-01-01T00:00:00Z"));
		const scheduler = new FakeScheduler(clock);
		const seedingClient = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
		});

		await seedingClient.handleCallback(
			"access_token=seed-at&id_token=seed-idt&refresh_token=seed-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-2",
		);
		seedingClient.dispose();

		const restoringClient = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
		});

		const result = await bootstrapBackendOidcModeClient(restoringClient, {
			location: {
				href: "https://app.example.com/token-set",
				hash: "",
			},
			history: createHistoryRecorder(),
			callbackFragmentStore: createBackendOidcModeCallbackFragmentStore({
				sessionStore,
			}),
		});

		expect(result.source).toBe("restore");
		expect(result.snapshot?.tokens.accessToken).toBe("seed-at");
	});

	it("keeps callback flow-state across cancellation and retries it on the next mount", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const clock = new FakeClock(Date.parse("2026-01-01T00:00:00Z"));
		const scheduler = new FakeScheduler(clock);
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStore,
		});
		const history = createHistoryRecorder();

		let resolveMetadata: ((response: HttpResponse) => void) | null = null;
		let notifyMetadataRequestStarted: (() => void) | null = null;
		const metadataRequestStarted = new Promise<void>((resolve) => {
			notifyMetadataRequestStarted = resolve;
		});
		const transport = new FakeTransport().on(
			(request: HttpRequest) => request.url.endsWith("/metadata/redeem"),
			() =>
				new Promise<HttpResponse>((resolve) => {
					resolveMetadata = resolve;
					notifyMetadataRequestStarted?.();
					notifyMetadataRequestStarted = null;
				}),
		);

		const firstClient = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
		});

		const firstBootstrap = bootstrapBackendOidcModeClient(firstClient, {
			location: {
				href: "https://app.example.com/token-set#access_token=late-at&id_token=late-idt&refresh_token=late-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-3",
				hash: "#access_token=late-at&id_token=late-idt&refresh_token=late-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-3",
			},
			history,
			callbackFragmentStore,
		});
		const firstBootstrapExpectation = expect(
			firstBootstrap,
		).rejects.toMatchObject({
			kind: ClientErrorKind.Cancelled,
		});

		await metadataRequestStarted;
		firstClient.dispose();
		const pendingMetadataResolver = resolveMetadata as unknown as (
			response: HttpResponse,
		) => void;
		if (!pendingMetadataResolver) {
			throw new Error("Expected pending metadata resolver to be registered");
		}
		pendingMetadataResolver({
			status: 200,
			headers: {},
			body: {
				metadata: {
					principal: {
						subject: "user-2",
						displayName: "Bob",
					},
				},
			},
		});

		await firstBootstrapExpectation;
		expect(await callbackFragmentStore.load()).toContain("late-at");

		transport.reset();
		transport.on(
			(request) => request.url.endsWith("/metadata/redeem"),
			() => ({
				status: 200,
				headers: {},
				body: {
					metadata: {
						principal: {
							subject: "user-2",
							displayName: "Bob",
						},
					},
				},
			}),
		);

		const secondClient = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
		});
		const retried = await bootstrapBackendOidcModeClient(secondClient, {
			location: {
				href: "https://app.example.com/token-set",
				hash: "",
			},
			history: createHistoryRecorder(),
			callbackFragmentStore,
		});

		expect(retried.source).toBe(BackendOidcModeBootstrapSource.Callback);
		expect(retried.snapshot?.tokens.accessToken).toBe("late-at");
		expect(await callbackFragmentStore.load()).toBeNull();
	});

	it("keeps callback flow-state across retryable callback failures and retries it on the next mount", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const clock = new FakeClock(Date.parse("2026-01-01T00:00:00Z"));
		const scheduler = new FakeScheduler(clock);
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStore,
		});
		const transport = new FakeTransport().on(
			(request) => request.url.endsWith("/metadata/redeem"),
			() => ({
				status: 503,
				headers: {},
				body: {
					message: "metadata temporarily unavailable",
				},
			}),
		);

		const firstClient = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
		});

		await expect(
			bootstrapBackendOidcModeClient(firstClient, {
				location: {
					href: "https://app.example.com/token-set#access_token=retry-at&id_token=retry-idt&refresh_token=retry-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-5",
					hash: "#access_token=retry-at&id_token=retry-idt&refresh_token=retry-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-5",
				},
				history: createHistoryRecorder(),
				callbackFragmentStore,
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Server,
			retryable: true,
			recovery: UserRecovery.Retry,
		});
		expect(await callbackFragmentStore.load()).toContain("retry-at");

		transport.reset();
		transport.on(
			(request) => request.url.endsWith("/metadata/redeem"),
			() => ({
				status: 200,
				headers: {},
				body: {
					metadata: {
						principal: {
							subject: "user-3",
							displayName: "Carol",
						},
					},
				},
			}),
		);

		const secondClient = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
		});
		const retried = await bootstrapBackendOidcModeClient(secondClient, {
			location: {
				href: "https://app.example.com/token-set",
				hash: "",
			},
			history: createHistoryRecorder(),
			callbackFragmentStore,
		});

		expect(retried.source).toBe(BackendOidcModeBootstrapSource.Callback);
		expect(retried.snapshot?.tokens.accessToken).toBe("retry-at");
		expect(retried.snapshot?.metadata.principal?.displayName).toBe("Carol");
		expect(await callbackFragmentStore.load()).toBeNull();
	});

	it("propagates redirect and current metadata into refresh requests", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const clock = new FakeClock(Date.parse("2026-01-01T00:00:00Z"));
		const scheduler = new FakeScheduler(clock);
		const transport = createTokenSetTransport().on(
			(request) => request.url.endsWith("/refresh"),
			(request) => {
				expect(request.body).toContain(
					'"post_auth_redirect_uri":"https://app.example.com/token-set"',
				);
				expect(request.body).toContain('"current_metadata_snapshot"');
				expect(request.body).toContain('"displayName":"Alice"');
				return {
					status: 200,
					headers: {},
					body: {
						access_token: "refreshed-at",
						refresh_token: "refreshed-rt",
						expires_at: "2026-01-01T00:07:00Z",
					},
				};
			},
		);
		const client = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
			refreshWindowMs: 60_000,
		});

		await client.handleCallback(
			"access_token=seed-at&id_token=seed-idt&refresh_token=seed-rt&expires_at=2026-01-01T00%3A02%3A00Z&metadata_redemption_id=meta-4",
		);
		await client.refresh();

		expect(client.state.get()?.tokens.accessToken).toBe("refreshed-at");
	});

	it("loads groups through the real business path with the refreshed token-set bearer", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const clock = new FakeClock(Date.parse("2026-01-01T00:00:00Z"));
		const scheduler = new FakeScheduler(clock);
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
					expect(request.headers.authorization).toBe("Bearer refreshed-at");
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
		const client = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
			refreshWindowMs: 60_000,
		});

		await client.handleCallback(
			"access_token=seed-at&id_token=seed-idt&refresh_token=seed-rt&expires_at=2026-01-01T00%3A02%3A00Z&metadata_redemption_id=meta-6",
		);
		await client.refresh();
		await expect(
			listGroupsWithTokenSet(client, { transport }),
		).resolves.toEqual([
			{
				id: "group-1",
				name: "Admins",
			},
		]);
	});

	it("loads entries through a second business path with the refreshed token-set bearer", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const clock = new FakeClock(Date.parse("2026-01-01T00:00:00Z"));
		const scheduler = new FakeScheduler(clock);
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
					expect(request.headers.authorization).toBe("Bearer entries-at");
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
		const client = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
			refreshWindowMs: 60_000,
		});

		await client.handleCallback(
			"access_token=seed-at&id_token=seed-idt&refresh_token=seed-rt&expires_at=2026-01-01T00%3A02%3A00Z&metadata_redemption_id=meta-7",
		);
		await client.refresh();
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

	it("creates a token entry with the refreshed bearer and can reload entries afterward", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const clock = new FakeClock(Date.parse("2026-01-01T00:00:00Z"));
		const scheduler = new FakeScheduler(clock);
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
					expect(request.headers.authorization).toBe("Bearer mutation-at");
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
					expect(request.headers.authorization).toBe("Bearer mutation-at");
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
		const client = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
			refreshWindowMs: 60_000,
		});

		await client.handleCallback(
			"access_token=seed-at&id_token=seed-idt&refresh_token=seed-rt&expires_at=2026-01-01T00%3A02%3A00Z&metadata_redemption_id=meta-8",
		);
		await client.refresh();

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

	it("creates a basic entry with the refreshed bearer and can reload entries afterward", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const clock = new FakeClock(Date.parse("2026-01-01T00:00:00Z"));
		const scheduler = new FakeScheduler(clock);
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
					expect(request.headers.authorization).toBe("Bearer basic-at");
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
					expect(request.headers.authorization).toBe("Bearer basic-at");
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
		const client = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
			refreshWindowMs: 60_000,
		});

		await client.handleCallback(
			"access_token=seed-at&id_token=seed-idt&refresh_token=seed-rt&expires_at=2026-01-01T00%3A02%3A00Z&metadata_redemption_id=meta-9",
		);
		await client.refresh();

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

	it("creates a group with the refreshed bearer and can reload groups and entries afterward", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const clock = new FakeClock(Date.parse("2026-01-01T00:00:00Z"));
		const scheduler = new FakeScheduler(clock);
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
					expect(request.headers.authorization).toBe("Bearer group-at");
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
					expect(request.headers.authorization).toBe("Bearer group-at");
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
					expect(request.headers.authorization).toBe("Bearer group-at");
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
		const client = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
			refreshWindowMs: 60_000,
		});

		await client.handleCallback(
			"access_token=seed-at&id_token=seed-idt&refresh_token=seed-rt&expires_at=2026-01-01T00%3A02%3A00Z&metadata_redemption_id=meta-10",
		);
		await client.refresh();

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

	it("forwards cancellation and refuses to load groups without a token-set bearer", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const clock = new FakeClock(Date.parse("2026-01-01T00:00:00Z"));
		const scheduler = new FakeScheduler(clock);
		const cancellation = createCancellationTokenSource();
		let seenCancellationToken = false;
		const transport = new FakeTransport().on(
			(request) => request.url.endsWith("/api/groups"),
			(request) => {
				seenCancellationToken =
					request.cancellationToken === cancellation.token;
				return {
					status: 200,
					headers: {},
					body: [],
				};
			},
		);
		const client = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
		});

		await expect(
			listGroupsWithTokenSet(client, {
				transport,
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Unauthenticated,
			code: "backend_oidc.authorization.unavailable",
		});

		await client.handleCallback(
			"access_token=token-at&id_token=token-idt&refresh_token=token-rt&expires_at=2026-01-01T00%3A05%3A00Z",
		);
		await listGroupsWithTokenSet(client, {
			transport,
			cancellationToken: cancellation.token,
		});
		expect(seenCancellationToken).toBe(true);
	});

	it("bridges AbortSignal into the token-set request cancellation contract through the shared web helper", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const clock = new FakeClock(Date.parse("2026-01-01T00:00:00Z"));
		const scheduler = new FakeScheduler(clock);
		const controller = new AbortController();
		let seenCancelledState = false;
		let seenReason: unknown;
		const transport = new FakeTransport().on(
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
		const client = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
		});

		await client.handleCallback(
			"access_token=abort-at&id_token=abort-idt&refresh_token=abort-rt&expires_at=2026-01-01T00%3A05%3A00Z",
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

	it("forwards cancellation and refuses to load entries without a token-set bearer", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const clock = new FakeClock(Date.parse("2026-01-01T00:00:00Z"));
		const scheduler = new FakeScheduler(clock);
		const cancellation = createCancellationTokenSource();
		let seenCancellationToken = false;
		const transport = new FakeTransport().on(
			(request) => request.url.endsWith("/api/entries"),
			(request) => {
				seenCancellationToken =
					request.cancellationToken === cancellation.token;
				return {
					status: 200,
					headers: {},
					body: [],
				};
			},
		);
		const client = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
		});

		await expect(
			listEntriesWithTokenSet(client, {
				transport,
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Unauthenticated,
			code: "backend_oidc.authorization.unavailable",
		});

		await client.handleCallback(
			"access_token=entries-at&id_token=entries-idt&refresh_token=entries-rt&expires_at=2026-01-01T00%3A05%3A00Z",
		);
		await listEntriesWithTokenSet(client, {
			transport,
			cancellationToken: cancellation.token,
		});
		expect(seenCancellationToken).toBe(true);
	});

	it("forwards cancellation and preserves structured failure details for token entry mutation", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const clock = new FakeClock(Date.parse("2026-01-01T00:00:00Z"));
		const scheduler = new FakeScheduler(clock);
		const cancellation = createCancellationTokenSource();
		let seenCancellationToken = false;
		const transport = new FakeTransport().on(
			(request) => request.url.endsWith("/api/entries/token"),
			(request) => {
				seenCancellationToken =
					request.cancellationToken === cancellation.token;
				return {
					status: 409,
					headers: {},
					body: {
						code: "entry_name_conflict",
						message: "Entry name already exists",
						recovery: UserRecovery.Retry,
					},
				};
			},
		);
		const client = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
		});

		await expect(
			createTokenEntryWithTokenSet(
				client,
				{
					name: "Ops Robot",
					group_ids: ["group-1"],
				},
				{ transport },
			),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Unauthenticated,
			code: "backend_oidc.authorization.unavailable",
		});

		await client.handleCallback(
			"access_token=mutation-at&id_token=mutation-idt&refresh_token=mutation-rt&expires_at=2026-01-01T00%3A05%3A00Z",
		);

		await expect(
			createTokenEntryWithTokenSet(
				client,
				{
					name: "Ops Robot",
					group_ids: ["group-1"],
				},
				{
					transport,
					cancellationToken: cancellation.token,
				},
			),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Protocol,
			code: "entry_name_conflict",
			recovery: UserRecovery.Retry,
		});
		expect(seenCancellationToken).toBe(true);
	});

	it("forwards cancellation and preserves structured failure details for basic entry mutation", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const clock = new FakeClock(Date.parse("2026-01-01T00:00:00Z"));
		const scheduler = new FakeScheduler(clock);
		const cancellation = createCancellationTokenSource();
		let seenCancellationToken = false;
		const transport = new FakeTransport().on(
			(request) => request.url.endsWith("/api/entries/basic"),
			(request) => {
				seenCancellationToken =
					request.cancellationToken === cancellation.token;
				return {
					status: 409,
					headers: {},
					body: {
						code: "entry_username_conflict",
						message: "Entry username already exists",
						recovery: UserRecovery.Retry,
					},
				};
			},
		);
		const client = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
		});

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
		).rejects.toMatchObject({
			kind: ClientErrorKind.Unauthenticated,
			code: "backend_oidc.authorization.unavailable",
		});

		await client.handleCallback(
			"access_token=basic-at&id_token=basic-idt&refresh_token=basic-rt&expires_at=2026-01-01T00%3A05%3A00Z",
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
				{
					transport,
					cancellationToken: cancellation.token,
				},
			),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Protocol,
			code: "entry_username_conflict",
			recovery: UserRecovery.Retry,
		});
		expect(seenCancellationToken).toBe(true);
	});

	it("forwards cancellation and preserves structured failure details for group mutation", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const clock = new FakeClock(Date.parse("2026-01-01T00:00:00Z"));
		const scheduler = new FakeScheduler(clock);
		const cancellation = createCancellationTokenSource();
		let seenCancellationToken = false;
		const transport = new FakeTransport().on(
			(request) =>
				request.url.endsWith("/api/groups") && request.method === "POST",
			(request) => {
				seenCancellationToken =
					request.cancellationToken === cancellation.token;
				return {
					status: 409,
					headers: {},
					body: {
						code: "group_name_conflict",
						message: "Group name already exists",
						recovery: UserRecovery.Retry,
					},
				};
			},
		);
		const client = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
		});

		await expect(
			createGroupWithTokenSet(
				client,
				{
					name: "Ops Team",
					entry_ids: ["entry-2"],
				},
				{ transport },
			),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Unauthenticated,
			code: "backend_oidc.authorization.unavailable",
		});

		await client.handleCallback(
			"access_token=group-at&id_token=group-idt&refresh_token=group-rt&expires_at=2026-01-01T00%3A05%3A00Z",
		);

		await expect(
			createGroupWithTokenSet(
				client,
				{
					name: "Ops Team",
					entry_ids: ["entry-2"],
				},
				{
					transport,
					cancellationToken: cancellation.token,
				},
			),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Protocol,
			code: "group_name_conflict",
			recovery: UserRecovery.Retry,
		});
		expect(seenCancellationToken).toBe(true);
	});

	it("probes the forward-auth boundary without treating 401 as a transport failure", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const clock = new FakeClock(Date.parse("2026-01-01T00:00:00Z"));
		const scheduler = new FakeScheduler(clock);
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
		const client = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
		});

		await client.handleCallback(
			"access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&expires_at=2026-01-01T00%3A05%3A00Z",
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
		const transport = new FakeTransport().on(
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
		const transport = new FakeTransport().on(
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
			probeForwardAuthWithBasicEntry("ops", "secret", "Admins", { transport }),
		).resolves.toEqual({
			status: 200,
			authenticated: true,
			authorizationChallenge: null,
			authenticatedEntry: "Ops Basic",
		});
	});

	it("probes the propagation route with dashboard bearer and explicit directive", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const clock = new FakeClock(Date.parse("2026-01-01T00:00:00Z"));
		const scheduler = new FakeScheduler(clock);
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
		const client = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
		});

		await client.handleCallback(
			"access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&expires_at=2026-01-01T00%3A05%3A00Z",
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
			recommendedConfigSnippet: `[token_set_context.token_propagation]
default_policy = "validate_then_forward"

[token_set_context.token_propagation.destination_policy]
allowed_targets = [
  { kind = "exact_origin", scheme = "http", hostname = "localhost", port = 7021 },
]

[propagation_forwarder]
proxy_path = "/api/propagation"`,
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
