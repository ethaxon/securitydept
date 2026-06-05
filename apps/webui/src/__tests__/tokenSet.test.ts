import {
	ClientErrorKind,
	type CreateFoundationEnvironmentOptions,
	createCancellationTokenSource,
	createFoundationEnvironment,
	createInMemoryRecordStore,
	createRootSpan,
	createTracing,
	type RouterNavigationRequest,
	readErrorPresentationDescriptor,
	SecuritydeptInjector,
	takeCompatFragmentFromRouter,
	UriReferenceString,
	UserRecovery,
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
import { provideAuthService } from "../lib/auth/authService";
import { TOKEN_SET_FRONTEND_MODE_CLIENT_KEY } from "../lib/tokenSetConfig";

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

function callbackParameters(fragment: string): Record<string, string> {
	const parameters = new URLSearchParams(fragment);
	const result: Record<string, string> = {};
	parameters.forEach((value, key) => {
		result[key] = value;
	});
	return result;
}

function createHistoryRecorder() {
	return {
		replacedUrl: "" as string,
		replaceState(_data: unknown, _unused: string, url?: string) {
			this.replacedUrl = url ?? "";
		},
	};
}

function createPageCallbackEnvironment(
	href: string,
	_storeOrHistory?: unknown,
	maybeHistory = createHistoryRecorder(),
	time = createTimeForTest({ initialNow: Date.parse("2026-01-01T00:00:00Z") }),
) {
	const history =
		typeof _storeOrHistory === "object" &&
		_storeOrHistory !== null &&
		"replaceState" in _storeOrHistory
			? (_storeOrHistory as ReturnType<typeof createHistoryRecorder>)
			: maybeHistory;
	const location = new URL(href);
	return {
		time,
		currentUrl() {
			return UriReferenceString.parse(location.toString());
		},
		canNavigate() {
			return true;
		},
		async navigate(request: RouterNavigationRequest) {
			const target = request.url.toString();
			if (request.mode === "replace") {
				history.replaceState(undefined, "", target);
			}
			location.hash = "";
		},
		history,
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
		createFoundationEnvironment({
			...environmentOptions,
			tracing: tracing ?? createTracing(),
		}),
	);
}

async function startBackendClientFromPage(
	client: ReturnType<typeof createBackendOidcModeTestClient>,
	options: { environment: ReturnType<typeof createPageCallbackEnvironment> },
) {
	const fragment = await takeCompatFragmentFromRouter(options.environment);
	if (fragment) {
		return await client.handleCallback(fragment.parameters);
	}
	return await client.start();
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

		let failure: unknown;
		try {
			await SecuritydeptInjector.fromParentInjector(
				createFoundationEnvironment({}).injector,
				provideAuthService(),
			)
				.get(TOKEN_SET_CLIENT_REGISTRY)
				.initialize(TOKEN_SET_FRONTEND_MODE_CLIENT_KEY);
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

	it("captures compat fragments, preserves route hash, and initializes client state", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const transport = createTokenSetTransport();
		const time = createTimeForTest({
			initialNow: Date.parse("2026-01-01T00:00:00Z"),
		});
		const client = createBackendOidcModeTestClient({
			span: createRootSpan(),
			persistentStorage,
			sessionStorage,
			transport,
			time,
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
		});
		const history = createHistoryRecorder();

		const result = await startBackendClientFromPage(client, {
			environment: createPageCallbackEnvironment(
				"https://app.example.com/token-set#/route#securitydept=v1&access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-1",
				history,
			),
		});

		expect(result?.tokens.accessToken).toBe("callback-at");
		expect(result?.metadata.principal?.displayName).toBe("Alice");
		expect(history.replacedUrl).toBe(
			"https://app.example.com/token-set#/route",
		);
		expect(time.pendingCount).toBe(0);
	});

	it("restores persisted token-set state when no callback fragment is pending", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const transport = createTokenSetTransport();
		const time = createTimeForTest({
			initialNow: Date.parse("2026-01-01T00:00:00Z"),
		});
		const seedingClient = createBackendOidcModeTestClient({
			span: createRootSpan(),
			persistentStorage,
			sessionStorage,
			transport,
			time,
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
		});

		await seedingClient.handleCallback(
			callbackParameters(
				"access_token=seed-at&id_token=seed-idt&refresh_token=seed-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-2",
			),
		);
		seedingClient.dispose();

		const restoringClient = createBackendOidcModeTestClient({
			span: createRootSpan(),
			persistentStorage,
			sessionStorage,
			transport,
			time,
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
		});

		const result = await startBackendClientFromPage(restoringClient, {
			environment: createPageCallbackEnvironment(
				"https://app.example.com/token-set",
			),
		});

		expect(result?.tokens.accessToken).toBe("seed-at");
	});

	it("propagates redirect and current metadata into refresh requests", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const time = createTimeForTest({
			initialNow: Date.parse("2026-01-01T00:00:00Z"),
		});
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
				"access_token=seed-at&id_token=seed-idt&refresh_token=seed-rt&expires_at=2026-01-01T00%3A02%3A00Z&metadata_redemption_id=meta-4",
			),
		);
		await client.refreshState();

		const slot = client.authSnapshot.get();
		expect(slot.kind === "value" ? slot.value?.tokens.accessToken : null).toBe(
			"seed-at",
		);
	});

	it("loads groups through the real business path with the refreshed token-set bearer", async () => {
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
		await client.refreshState();
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
		await client.refreshState();
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
		await client.refreshState();

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
		await client.refreshState();

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
		await client.refreshState();

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
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const time = createTimeForTest({
			initialNow: Date.parse("2026-01-01T00:00:00Z"),
		});
		const cancellation = createCancellationTokenSource();
		let seenCancellationToken = false;
		const transport = createTransportForTest().on(
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
		const client = createBackendOidcModeTestClient({
			span: createRootSpan(),
			persistentStorage,
			sessionStorage,
			transport,
			time,
		});
		await client.start();

		await expect(
			listGroupsWithTokenSet(client, {
				transport,
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Unauthenticated,
			code: "backend_oidc.authorization.unavailable",
		});

		await client.handleCallback(
			callbackParameters(
				"access_token=token-at&id_token=token-idt&refresh_token=token-rt&expires_at=2026-01-01T00%3A05%3A00Z",
			),
		);
		await listGroupsWithTokenSet(client, {
			transport,
			cancellationToken: cancellation.token,
		});
		expect(seenCancellationToken).toBe(true);
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

	it("forwards cancellation and refuses to load entries without a token-set bearer", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const time = createTimeForTest({
			initialNow: Date.parse("2026-01-01T00:00:00Z"),
		});
		const cancellation = createCancellationTokenSource();
		let seenCancellationToken = false;
		const transport = createTransportForTest().on(
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
		const client = createBackendOidcModeTestClient({
			span: createRootSpan(),
			persistentStorage,
			sessionStorage,
			transport,
			time,
		});
		await client.start();

		await expect(
			listEntriesWithTokenSet(client, {
				transport,
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Unauthenticated,
			code: "backend_oidc.authorization.unavailable",
		});

		await client.handleCallback(
			callbackParameters(
				"access_token=entries-at&id_token=entries-idt&refresh_token=entries-rt&expires_at=2026-01-01T00%3A05%3A00Z",
			),
		);
		await listEntriesWithTokenSet(client, {
			transport,
			cancellationToken: cancellation.token,
		});
		expect(seenCancellationToken).toBe(true);
	});

	it("forwards cancellation and preserves structured failure details for token entry mutation", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const time = createTimeForTest({
			initialNow: Date.parse("2026-01-01T00:00:00Z"),
		});
		const cancellation = createCancellationTokenSource();
		let seenCancellationToken = false;
		const transport = createTransportForTest().on(
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
		const client = createBackendOidcModeTestClient({
			span: createRootSpan(),
			persistentStorage,
			sessionStorage,
			transport,
			time,
		});
		await client.start();

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
			callbackParameters(
				"access_token=mutation-at&id_token=mutation-idt&refresh_token=mutation-rt&expires_at=2026-01-01T00%3A05%3A00Z",
			),
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
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const time = createTimeForTest({
			initialNow: Date.parse("2026-01-01T00:00:00Z"),
		});
		const cancellation = createCancellationTokenSource();
		let seenCancellationToken = false;
		const transport = createTransportForTest().on(
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
		const client = createBackendOidcModeTestClient({
			span: createRootSpan(),
			persistentStorage,
			sessionStorage,
			transport,
			time,
		});
		await client.start();

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
			callbackParameters(
				"access_token=basic-at&id_token=basic-idt&refresh_token=basic-rt&expires_at=2026-01-01T00%3A05%3A00Z",
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
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const time = createTimeForTest({
			initialNow: Date.parse("2026-01-01T00:00:00Z"),
		});
		const cancellation = createCancellationTokenSource();
		let seenCancellationToken = false;
		const transport = createTransportForTest().on(
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
		const client = createBackendOidcModeTestClient({
			span: createRootSpan(),
			persistentStorage,
			sessionStorage,
			transport,
			time,
		});
		await client.start();

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
			callbackParameters(
				"access_token=group-at&id_token=group-idt&refresh_token=group-rt&expires_at=2026-01-01T00%3A05%3A00Z",
			),
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
			probeForwardAuthWithBasicEntry("ops", "secret", "Admins", { transport }),
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
