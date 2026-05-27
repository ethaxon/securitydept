import {
	ClientErrorKind,
	createCancellationTokenSource,
	createInMemoryRecordStore,
	createRootSpan,
	createTracing,
	type HttpRequest,
	type HttpResponse,
	type TimeTrait,
	UserRecovery,
} from "@securitydept/client";
import { createRouterForNativeWeb } from "@securitydept/client/web";
import { describe, expect, it, vi } from "vitest";
import { createBackendOidcModeAuthorizedTransportFromBase } from "../transport/auth-transport";
import {
	BackendOidcModeBootstrapSource,
	type BackendOidcModePageCallbackCapability,
	bootstrapBackendOidcModePageClient,
	type CreateBackendOidcModeWebClientEnvironmentOptions,
	type CreateBackendOidcModeWebClientOptions,
	captureBackendOidcModeCallbackFragment,
	createBackendOidcModeCallbackFragmentStore,
	createBackendOidcModeWebClientEnvironment,
	loginWithBackendOidcPopup,
	loginWithBackendOidcRedirect,
	createBackendOidcModeWebClient as materializeBackendOidcModeWebClient,
	relayBackendOidcPopupCallback,
	resetBackendOidcModeBrowserState,
	resolveBackendOidcModeCallbackFragmentKey,
} from "../web/browser";

function expectReplayValue<T>(signal: {
	get(): { kind: "empty" } | { kind: "value"; value: T };
}): T {
	const slot = signal.get();
	expect(slot.kind).toBe("value");
	if (slot.kind !== "value") {
		throw new Error("Expected replay signal value.");
	}
	return slot.value;
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
	callbackFragmentStore: ReturnType<
		typeof createBackendOidcModeCallbackFragmentStore
	>,
	history = createHistoryRecorder(),
): BackendOidcModePageCallbackCapability {
	const url = new URL(href);
	const location = {
		href,
		hash: url.hash,
	};
	return {
		...createRouterForNativeWeb({ location, history }),
		callbackFragmentStore,
		time: testTime,
	};
}

const testTime: TimeTrait = {
	now: () => Date.parse("2026-01-01T00:00:00Z"),
	setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
	clearTimeout: (handle) =>
		globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

type BackendOidcModeTestClientOptions = Omit<
	CreateBackendOidcModeWebClientOptions,
	"environment"
> &
	Omit<CreateBackendOidcModeWebClientEnvironmentOptions, "tracing"> & {
		transport?: CreateBackendOidcModeWebClientEnvironmentOptions["transport"];
		tracing?: CreateBackendOidcModeWebClientEnvironmentOptions["tracing"];
	};

function createBackendOidcModeWebClient(
	options: BackendOidcModeTestClientOptions,
) {
	const {
		environment,
		persistentStorage,
		sessionStorage,
		callbackFragmentStore,
		transport,
		span,
		time,
		tracing,
		...clientOptions
	} = options;

	return materializeBackendOidcModeWebClient({
		...clientOptions,
		environment: createBackendOidcModeWebClientEnvironment({
			environment,
			persistentStorage,
			sessionStorage,
			callbackFragmentStore,
			transport,
			span,
			time,
			tracing: tracing ?? createTracing(),
		}),
	});
}

describe("token-set web helpers", () => {
	it("captures callback fragments and clears only the URL hash from history", async () => {
		const sessionStorage = createInMemoryRecordStore();
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStorage,
		});
		const history = createHistoryRecorder();

		const fragment = await captureBackendOidcModeCallbackFragment({
			environment: createPageCallbackEnvironment(
				"https://app.example.com/oidc-mediated?tab=demo#access_token=callback-at&id_token=callback-idt",
				callbackFragmentStore,
				history,
			),
		});

		expect(fragment).toBe("access_token=callback-at&id_token=callback-idt");
		expect(await callbackFragmentStore.load()).toBe(
			"access_token=callback-at&id_token=callback-idt",
		);
		expect(history.replacedUrl).toBe("/oidc-mediated?tab=demo");
	});

	it("does not touch history when there is no callback fragment", async () => {
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStorage: createInMemoryRecordStore(),
		});
		const history = createHistoryRecorder();

		const fragment = await captureBackendOidcModeCallbackFragment({
			environment: createPageCallbackEnvironment(
				"https://app.example.com/oidc-mediated?tab=demo",
				callbackFragmentStore,
				history,
			),
		});

		expect(fragment).toBeNull();
		expect(history.replacedUrl).toBe("");
	});

	it("bootstraps browser client state from a callback fragment", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const transport = {
			async execute(request: HttpRequest): Promise<HttpResponse> {
				if (request.url.endsWith("/metadata/redeem")) {
					return {
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
					};
				}

				throw new Error(`Unexpected request: ${request.method} ${request.url}`);
			},
		};
		const client = createBackendOidcModeWebClient({
			span: createRootSpan(),
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
			defaultPostAuthRedirectUri: "https://app.example.com/oidc-mediated",
		});
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStorage,
		});

		const result = await bootstrapBackendOidcModePageClient(client, {
			environment: createPageCallbackEnvironment(
				"https://app.example.com/oidc-mediated#access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-1",
				callbackFragmentStore,
			),
		});

		expect(result.source).toBe(BackendOidcModeBootstrapSource.Callback);
		expect(result.snapshot?.tokens.accessToken).toBe("callback-at");
		expect(await callbackFragmentStore.load()).toBeNull();
	});

	it("retains callback fragments when bootstrap fails with a retryable error", async () => {
		const sessionStorage = createInMemoryRecordStore();
		const client = createBackendOidcModeWebClient({
			span: createRootSpan(),
			sessionStorage,
			persistentStorage: createInMemoryRecordStore(),
			transport: {
				async execute(): Promise<HttpResponse> {
					return {
						status: 503,
						headers: {},
						body: null,
					};
				},
			},
		});
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStorage,
		});

		await expect(
			bootstrapBackendOidcModePageClient(client, {
				environment: createPageCallbackEnvironment(
					"https://app.example.com/oidc-mediated#access_token=callback-at&id_token=callback-idt&metadata_redemption_id=meta-1",
					callbackFragmentStore,
				),
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Server,
			recovery: UserRecovery.Retry,
		});
		expect(await callbackFragmentStore.load()).toBe(
			"access_token=callback-at&id_token=callback-idt&metadata_redemption_id=meta-1",
		);
	});

	it("clears callback fragments when bootstrap fails with a non-retryable error", async () => {
		const sessionStorage = createInMemoryRecordStore();
		const client = createBackendOidcModeWebClient({
			span: createRootSpan(),
			sessionStorage,
			persistentStorage: createInMemoryRecordStore(),
			transport: {
				async execute(): Promise<HttpResponse> {
					throw new Error("transport should not be called");
				},
			},
		});
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStorage,
		});

		await expect(
			bootstrapBackendOidcModePageClient(client, {
				environment: createPageCallbackEnvironment(
					"https://app.example.com/oidc-mediated#refresh_token=callback-rt",
					callbackFragmentStore,
				),
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Protocol,
			code: "callback.missing_access_token",
		});
		expect(await callbackFragmentStore.load()).toBeNull();
	});

	it("resets browser state by clearing both callback fragments and persisted auth", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const client = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStorage,
			sessionStorage,
			transport: {
				async execute(request: HttpRequest): Promise<HttpResponse> {
					if (request.url.endsWith("/metadata/redeem")) {
						return {
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
						};
					}

					throw new Error(
						`Unexpected request: ${request.method} ${request.url}`,
					);
				},
			},
		});
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStorage,
		});

		await client.handleCallback(
			"access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&metadata_redemption_id=meta-1",
		);
		await callbackFragmentStore.save("access_token=pending-at");

		await resetBackendOidcModeBrowserState(client, { callbackFragmentStore });

		expect(expectReplayValue(client.authSnapshot)).toBeNull();
		expect(await callbackFragmentStore.load()).toBeNull();

		const restoredClient = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStorage,
			sessionStorage,
			transport: {
				async execute(): Promise<HttpResponse> {
					return {
						status: 500,
						headers: {},
						body: null,
					};
				},
			},
		});

		await expect(restoredClient.restorePersistedState()).resolves.toBeNull();
	});

	it("restores persisted auth across fresh browser clients sharing the same stores", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const transport = {
			async execute(request: HttpRequest): Promise<HttpResponse> {
				if (request.url.endsWith("/metadata/redeem")) {
					return {
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
					};
				}

				throw new Error(`Unexpected request: ${request.method} ${request.url}`);
			},
		};
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStorage,
		});
		const firstClient = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
			defaultPostAuthRedirectUri: "https://app.example.com/oidc-mediated",
		});

		const callbackResult = await bootstrapBackendOidcModePageClient(
			firstClient,
			{
				environment: createPageCallbackEnvironment(
					"https://app.example.com/oidc-mediated#access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-1",
					callbackFragmentStore,
				),
			},
		);

		expect(callbackResult.source).toBe(BackendOidcModeBootstrapSource.Callback);
		expect(await callbackFragmentStore.load()).toBeNull();

		const restoredClient = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
		});

		const restoredResult = await bootstrapBackendOidcModePageClient(
			restoredClient,
			{
				environment: createPageCallbackEnvironment(
					"https://app.example.com/oidc-mediated",
					callbackFragmentStore,
				),
			},
		);

		expect(restoredResult.source).toBe(BackendOidcModeBootstrapSource.Restore);
		expect(restoredResult.snapshot?.tokens.accessToken).toBe("callback-at");
		expect(
			expectReplayValue(restoredClient.authSnapshot)?.metadata.principal
				?.displayName,
		).toBe("Alice");

		await resetBackendOidcModeBrowserState(restoredClient, {
			callbackFragmentStore,
		});

		const freshClient = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
		});

		const emptyResult = await bootstrapBackendOidcModePageClient(freshClient, {
			environment: createPageCallbackEnvironment(
				"https://app.example.com/oidc-mediated",
				callbackFragmentStore,
			),
		});

		expect(emptyResult).toEqual({
			source: BackendOidcModeBootstrapSource.Empty,
			snapshot: null,
		});
		expect(expectReplayValue(freshClient.authSnapshot)).toBeNull();
		expect(await callbackFragmentStore.load()).toBeNull();
	});

	it("prefers a pending callback fragment over persisted auth and replaces the old state", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const transport = {
			async execute(request: HttpRequest): Promise<HttpResponse> {
				if (request.url.endsWith("/metadata/redeem")) {
					const redemptionId =
						typeof request.body === "string"
							? (
									JSON.parse(request.body) as {
										metadata_redemption_id?: string;
									}
								).metadata_redemption_id
							: undefined;
					if (redemptionId === "meta-old") {
						return {
							status: 200,
							headers: {},
							body: {
								metadata: {
									principal: {
										subject: "user-old",
										displayName: "Old Alice",
									},
								},
							},
						};
					}

					if (redemptionId === "meta-new") {
						return {
							status: 200,
							headers: {},
							body: {
								metadata: {
									principal: {
										subject: "user-new",
										displayName: "New Alice",
									},
								},
							},
						};
					}
				}

				throw new Error(`Unexpected request: ${request.method} ${request.url}`);
			},
		};
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStorage,
		});
		const oldClient = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
		});

		await oldClient.handleCallback(
			"access_token=old-at&id_token=old-idt&refresh_token=old-rt&metadata_redemption_id=meta-old",
		);
		expect(expectReplayValue(oldClient.authSnapshot)?.tokens.accessToken).toBe(
			"old-at",
		);

		const bootstrapClient = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
		});

		const callbackResult = await bootstrapBackendOidcModePageClient(
			bootstrapClient,
			{
				environment: createPageCallbackEnvironment(
					"https://app.example.com/oidc-mediated#access_token=new-at&id_token=new-idt&refresh_token=new-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-new",
					callbackFragmentStore,
				),
			},
		);

		expect(callbackResult.source).toBe(BackendOidcModeBootstrapSource.Callback);
		expect(callbackResult.snapshot?.tokens.accessToken).toBe("new-at");
		expect(
			expectReplayValue(bootstrapClient.authSnapshot)?.tokens.accessToken,
		).toBe("new-at");
		expect(
			expectReplayValue(bootstrapClient.authSnapshot)?.metadata.principal
				?.displayName,
		).toBe("New Alice");
		expect(await callbackFragmentStore.load()).toBeNull();

		const restoredClient = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
		});

		const restoredResult = await bootstrapBackendOidcModePageClient(
			restoredClient,
			{
				environment: createPageCallbackEnvironment(
					"https://app.example.com/oidc-mediated",
					callbackFragmentStore,
				),
			},
		);

		expect(restoredResult.source).toBe(BackendOidcModeBootstrapSource.Restore);
		expect(restoredResult.snapshot?.tokens.accessToken).toBe("new-at");
		expect(restoredResult.snapshot?.tokens.accessToken).not.toBe("old-at");
		expect(
			expectReplayValue(restoredClient.authSnapshot)?.metadata.principal
				?.displayName,
		).toBe("New Alice");
	});

	it("keeps callback retry precedence over persisted auth until a later retry succeeds", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		let newRedemptionAttempts = 0;
		const transport = {
			async execute(request: HttpRequest): Promise<HttpResponse> {
				if (request.url.endsWith("/metadata/redeem")) {
					const redemptionId =
						typeof request.body === "string"
							? (
									JSON.parse(request.body) as {
										metadata_redemption_id?: string;
									}
								).metadata_redemption_id
							: undefined;
					if (redemptionId === "meta-old") {
						return {
							status: 200,
							headers: {},
							body: {
								metadata: {
									principal: {
										subject: "user-old",
										displayName: "Old Alice",
									},
								},
							},
						};
					}

					if (redemptionId === "meta-new") {
						newRedemptionAttempts += 1;
						if (newRedemptionAttempts === 1) {
							return {
								status: 503,
								headers: {},
								body: null,
							};
						}

						return {
							status: 200,
							headers: {},
							body: {
								metadata: {
									principal: {
										subject: "user-new",
										displayName: "New Alice",
									},
								},
							},
						};
					}
				}

				throw new Error(`Unexpected request: ${request.method} ${request.url}`);
			},
		};
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStorage,
		});
		const oldClient = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
		});

		await oldClient.handleCallback(
			"access_token=old-at&id_token=old-idt&refresh_token=old-rt&metadata_redemption_id=meta-old",
		);

		const retryingClient = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
		});

		await expect(
			bootstrapBackendOidcModePageClient(retryingClient, {
				environment: createPageCallbackEnvironment(
					"https://app.example.com/oidc-mediated#access_token=new-at&id_token=new-idt&refresh_token=new-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-new",
					callbackFragmentStore,
				),
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Server,
			recovery: UserRecovery.Retry,
		});

		expect(await callbackFragmentStore.load()).toBe(
			"access_token=new-at&id_token=new-idt&refresh_token=new-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-new",
		);
		expect(retryingClient.authSnapshot.hasValue()).toBe(false);

		const recoveredResult = await bootstrapBackendOidcModePageClient(
			retryingClient,
			{
				environment: createPageCallbackEnvironment(
					"https://app.example.com/oidc-mediated",
					callbackFragmentStore,
				),
			},
		);

		expect(recoveredResult.source).toBe(
			BackendOidcModeBootstrapSource.Callback,
		);
		expect(recoveredResult.snapshot?.tokens.accessToken).toBe("new-at");
		expect(
			expectReplayValue(retryingClient.authSnapshot)?.metadata.principal
				?.displayName,
		).toBe("New Alice");
		expect(await callbackFragmentStore.load()).toBeNull();

		const restoredClient = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
		});

		const restoredResult = await bootstrapBackendOidcModePageClient(
			restoredClient,
			{
				environment: createPageCallbackEnvironment(
					"https://app.example.com/oidc-mediated",
					callbackFragmentStore,
				),
			},
		);

		expect(restoredResult.source).toBe(BackendOidcModeBootstrapSource.Restore);
		expect(restoredResult.snapshot?.tokens.accessToken).toBe("new-at");
		expect(restoredResult.snapshot?.tokens.accessToken).not.toBe("old-at");
	});

	it("clears non-retryable callback precedence and only restores old state on a later fresh bootstrap", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const transport = {
			async execute(request: HttpRequest): Promise<HttpResponse> {
				if (request.url.endsWith("/metadata/redeem")) {
					const redemptionId =
						typeof request.body === "string"
							? (
									JSON.parse(request.body) as {
										metadata_redemption_id?: string;
									}
								).metadata_redemption_id
							: undefined;
					if (redemptionId === "meta-old") {
						return {
							status: 200,
							headers: {},
							body: {
								metadata: {
									principal: {
										subject: "user-old",
										displayName: "Old Alice",
									},
								},
							},
						};
					}

					if (redemptionId === "meta-bad") {
						return {
							status: 400,
							headers: {},
							body: {
								code: "metadata.invalid_redemption",
								message: "invalid metadata redemption",
							},
						};
					}
				}

				throw new Error(`Unexpected request: ${request.method} ${request.url}`);
			},
		};
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStorage,
		});
		const oldClient = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
		});

		await oldClient.handleCallback(
			"access_token=old-at&id_token=old-idt&refresh_token=old-rt&metadata_redemption_id=meta-old",
		);
		expect(expectReplayValue(oldClient.authSnapshot)?.tokens.accessToken).toBe(
			"old-at",
		);

		const failingClient = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
		});

		await expect(
			bootstrapBackendOidcModePageClient(failingClient, {
				environment: createPageCallbackEnvironment(
					"https://app.example.com/oidc-mediated#access_token=bad-at&id_token=bad-idt&refresh_token=bad-rt&metadata_redemption_id=meta-bad",
					callbackFragmentStore,
				),
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Protocol,
			retryable: false,
		});

		expect(await callbackFragmentStore.load()).toBeNull();
		expect(failingClient.authSnapshot.hasValue()).toBe(false);

		const restoredClient = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
		});

		const restoredResult = await bootstrapBackendOidcModePageClient(
			restoredClient,
			{
				environment: createPageCallbackEnvironment(
					"https://app.example.com/oidc-mediated",
					callbackFragmentStore,
				),
			},
		);

		expect(restoredResult.source).toBe(BackendOidcModeBootstrapSource.Restore);
		expect(restoredResult.snapshot?.tokens.accessToken).toBe("old-at");
		expect(
			expectReplayValue(restoredClient.authSnapshot)?.metadata.principal
				?.displayName,
		).toBe("Old Alice");
		expect(restoredResult.snapshot?.tokens.accessToken).not.toBe("bad-at");
	});

	it("replaces a retained pending fragment with the latest URL callback before bootstrap", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const transport = {
			async execute(request: HttpRequest): Promise<HttpResponse> {
				if (request.url.endsWith("/metadata/redeem")) {
					const redemptionId =
						typeof request.body === "string"
							? (
									JSON.parse(request.body) as {
										metadata_redemption_id?: string;
									}
								).metadata_redemption_id
							: undefined;
					if (redemptionId === "meta-new") {
						return {
							status: 200,
							headers: {},
							body: {
								metadata: {
									principal: {
										subject: "user-new",
										displayName: "Newest Alice",
									},
								},
							},
						};
					}
				}

				throw new Error(`Unexpected request: ${request.method} ${request.url}`);
			},
		};
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStorage,
		});

		await callbackFragmentStore.save(
			"access_token=old-at&id_token=old-idt&refresh_token=old-rt&metadata_redemption_id=meta-old",
		);

		const history = createHistoryRecorder();
		const capturedFragment = await captureBackendOidcModeCallbackFragment({
			environment: createPageCallbackEnvironment(
				"https://app.example.com/oidc-mediated?tab=members#access_token=new-at&id_token=new-idt&refresh_token=new-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-new",
				callbackFragmentStore,
				history,
			),
		});

		expect(capturedFragment).toBe(
			"access_token=new-at&id_token=new-idt&refresh_token=new-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-new",
		);
		expect(await callbackFragmentStore.load()).toBe(
			"access_token=new-at&id_token=new-idt&refresh_token=new-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-new",
		);
		expect(history.replacedUrl).toBe("/oidc-mediated?tab=members");

		const bootstrapClient = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
		});

		const callbackResult = await bootstrapBackendOidcModePageClient(
			bootstrapClient,
			{
				environment: createPageCallbackEnvironment(
					"https://app.example.com/oidc-mediated?tab=members",
					callbackFragmentStore,
				),
			},
		);

		expect(callbackResult.source).toBe(BackendOidcModeBootstrapSource.Callback);
		expect(callbackResult.snapshot?.tokens.accessToken).toBe("new-at");
		expect(
			expectReplayValue(bootstrapClient.authSnapshot)?.metadata.principal
				?.displayName,
		).toBe("Newest Alice");
		expect(await callbackFragmentStore.load()).toBeNull();

		const restoredClient = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
		});

		const restoredResult = await bootstrapBackendOidcModePageClient(
			restoredClient,
			{
				environment: createPageCallbackEnvironment(
					"https://app.example.com/oidc-mediated?tab=members",
					callbackFragmentStore,
				),
			},
		);

		expect(restoredResult.source).toBe(BackendOidcModeBootstrapSource.Restore);
		expect(restoredResult.snapshot?.tokens.accessToken).toBe("new-at");
		expect(restoredResult.snapshot?.tokens.accessToken).not.toBe("old-at");
	});

	it("replaces a retry-retained pending fragment with the latest URL callback before recovery bootstrap", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const transport = {
			async execute(request: HttpRequest): Promise<HttpResponse> {
				if (request.url.endsWith("/metadata/redeem")) {
					const redemptionId =
						typeof request.body === "string"
							? (
									JSON.parse(request.body) as {
										metadata_redemption_id?: string;
									}
								).metadata_redemption_id
							: undefined;
					if (redemptionId === "meta-retry") {
						return {
							status: 503,
							headers: {},
							body: null,
						};
					}

					if (redemptionId === "meta-new") {
						return {
							status: 200,
							headers: {},
							body: {
								metadata: {
									principal: {
										subject: "user-new",
										displayName: "Newest Alice",
									},
								},
							},
						};
					}
				}

				throw new Error(`Unexpected request: ${request.method} ${request.url}`);
			},
		};
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStorage,
		});
		const retryingClient = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
		});

		await expect(
			bootstrapBackendOidcModePageClient(retryingClient, {
				environment: createPageCallbackEnvironment(
					"https://app.example.com/oidc-mediated#access_token=retry-at&id_token=retry-idt&refresh_token=retry-rt&metadata_redemption_id=meta-retry",
					callbackFragmentStore,
				),
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Server,
			recovery: UserRecovery.Retry,
		});

		expect(await callbackFragmentStore.load()).toBe(
			"access_token=retry-at&id_token=retry-idt&refresh_token=retry-rt&metadata_redemption_id=meta-retry",
		);

		const history = createHistoryRecorder();
		const recoveredResult = await bootstrapBackendOidcModePageClient(
			retryingClient,
			{
				environment: createPageCallbackEnvironment(
					"https://app.example.com/oidc-mediated?tab=members#access_token=new-at&id_token=new-idt&refresh_token=new-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-new",
					callbackFragmentStore,
					history,
				),
			},
		);

		expect(history.replacedUrl).toBe("/oidc-mediated?tab=members");
		expect(recoveredResult.source).toBe(
			BackendOidcModeBootstrapSource.Callback,
		);
		expect(recoveredResult.snapshot?.tokens.accessToken).toBe("new-at");
		expect(
			expectReplayValue(retryingClient.authSnapshot)?.metadata.principal
				?.displayName,
		).toBe("Newest Alice");
		expect(await callbackFragmentStore.load()).toBeNull();

		const restoredClient = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
		});

		const restoredResult = await bootstrapBackendOidcModePageClient(
			restoredClient,
			{
				environment: createPageCallbackEnvironment(
					"https://app.example.com/oidc-mediated?tab=members",
					callbackFragmentStore,
				),
			},
		);

		expect(restoredResult.source).toBe(BackendOidcModeBootstrapSource.Restore);
		expect(restoredResult.snapshot?.tokens.accessToken).toBe("new-at");
		expect(restoredResult.snapshot?.tokens.accessToken).not.toBe("retry-at");
	});

	it("returns to empty after reset clears a latest-callback replacement state", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const transport = {
			async execute(request: HttpRequest): Promise<HttpResponse> {
				if (request.url.endsWith("/metadata/redeem")) {
					const redemptionId =
						typeof request.body === "string"
							? (
									JSON.parse(request.body) as {
										metadata_redemption_id?: string;
									}
								).metadata_redemption_id
							: undefined;
					if (redemptionId === "meta-new") {
						return {
							status: 200,
							headers: {},
							body: {
								metadata: {
									principal: {
										subject: "user-new",
										displayName: "Newest Alice",
									},
								},
							},
						};
					}
				}

				throw new Error(`Unexpected request: ${request.method} ${request.url}`);
			},
		};
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStorage,
		});

		await callbackFragmentStore.save(
			"access_token=old-at&id_token=old-idt&refresh_token=old-rt&metadata_redemption_id=meta-old",
		);

		const bootstrapClient = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
		});

		const callbackResult = await bootstrapBackendOidcModePageClient(
			bootstrapClient,
			{
				environment: createPageCallbackEnvironment(
					"https://app.example.com/oidc-mediated?tab=members#access_token=new-at&id_token=new-idt&refresh_token=new-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-new",
					callbackFragmentStore,
				),
			},
		);

		expect(callbackResult.source).toBe(BackendOidcModeBootstrapSource.Callback);
		expect(callbackResult.snapshot?.tokens.accessToken).toBe("new-at");
		expect(await callbackFragmentStore.load()).toBeNull();

		await resetBackendOidcModeBrowserState(bootstrapClient, {
			callbackFragmentStore,
		});

		expect(expectReplayValue(bootstrapClient.authSnapshot)).toBeNull();
		expect(await callbackFragmentStore.load()).toBeNull();

		const freshClient = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
		});

		const emptyResult = await bootstrapBackendOidcModePageClient(freshClient, {
			environment: createPageCallbackEnvironment(
				"https://app.example.com/oidc-mediated?tab=members",
				callbackFragmentStore,
			),
		});

		expect(emptyResult).toEqual({
			source: BackendOidcModeBootstrapSource.Empty,
			snapshot: null,
		});
		expect(expectReplayValue(freshClient.authSnapshot)).toBeNull();
	});

	it("injects the current bearer and forwards cancellation tokens", async () => {
		const cancellation = createCancellationTokenSource();
		const requests: HttpRequest[] = [];
		const transport = createBackendOidcModeAuthorizedTransportFromBase(
			{
				authorizationHeader: () => "Bearer token-set-at",
			},
			{
				baseTransport: {
					async execute(request: HttpRequest): Promise<HttpResponse> {
						requests.push(request);
						return {
							status: 200,
							headers: {},
							body: [],
						};
					},
				},
			},
		);

		await transport.execute({
			url: "/api/groups",
			method: "GET",
			headers: {
				accept: "application/json",
			},
			cancellationToken: cancellation.token,
		});

		expect(requests).toHaveLength(1);
		expect(requests[0]?.headers.authorization).toBe("Bearer token-set-at");
		expect(requests[0]?.cancellationToken).toBe(cancellation.token);
	});

	it("refuses to fall back when token-set authorization is unavailable", async () => {
		const transport = createBackendOidcModeAuthorizedTransportFromBase(
			{
				authorizationHeader: () => null,
			},
			{
				baseTransport: {
					async execute(): Promise<HttpResponse> {
						return {
							status: 200,
							headers: {},
							body: null,
						};
					},
				},
			},
		);

		await expect(
			transport.execute({
				url: "/api/groups",
				method: "GET",
				headers: {},
			}),
		).rejects.toMatchObject({
			kind: "unauthenticated",
			code: "backend_oidc.authorization.unavailable",
		});
	});

	it("forwards persistentStateKey through the browser entry to isolate persisted state", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const transport = {
			async execute(request: HttpRequest): Promise<HttpResponse> {
				if (request.url.endsWith("/metadata/redeem")) {
					return {
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
					};
				}

				throw new Error(`Unexpected request: ${request.method} ${request.url}`);
			},
		};

		// Client A: uses a custom persistentStateKey
		const clientA = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStateKey: "tenant-a",
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
		});

		await clientA.handleCallback(
			"access_token=a-at&id_token=a-idt&refresh_token=a-rt&metadata_redemption_id=meta-a",
		);
		expect(expectReplayValue(clientA.authSnapshot)?.tokens.accessToken).toBe(
			"a-at",
		);

		// Client B: uses a different persistentStateKey on the same store
		const clientB = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStateKey: "tenant-b",
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
		});

		// Client B must NOT see Client A's state
		const restoredB = await clientB.restorePersistedState();
		expect(restoredB).toBeNull();

		// Client C: uses the same key as A — must see A's state
		const clientC = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStateKey: "tenant-a",
			persistentStorage,
			sessionStorage,
			transport,
			time: testTime,
		});

		const restoredC = await clientC.restorePersistedState();
		expect(restoredC?.tokens.accessToken).toBe("a-at");
	});

	it("isolates callback fragments via callbackFragmentKey in the default bootstrap path", async () => {
		// Two integrations share a single in-memory session store (same origin scenario).
		// Each constructs an explicit namespaced callback-fragment store and passes it
		// through the unified page callback environment.
		const sharedPersistentStore = createInMemoryRecordStore();
		const sharedSessionStore = createInMemoryRecordStore();

		const makeTransport = (
			subject: string,
		): { execute: (req: HttpRequest) => Promise<HttpResponse> } => ({
			async execute(request: HttpRequest): Promise<HttpResponse> {
				if (request.url.endsWith("/metadata/redeem")) {
					return {
						status: 200,
						headers: {},
						body: {
							metadata: { principal: { subject, displayName: subject } },
						},
					};
				}
				throw new Error(`Unexpected: ${request.url}`);
			},
		});

		const keyA = resolveBackendOidcModeCallbackFragmentKey("tenant-a");
		const keyB = resolveBackendOidcModeCallbackFragmentKey("tenant-b");
		expect(keyA).not.toBe(keyB);

		const clientA = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStateKey: "tenant-a",
			persistentStorage: sharedPersistentStore,
			sessionStorage: sharedSessionStore,
			transport: makeTransport("alice"),
			time: testTime,
		});

		// Integration A bootstraps with a callback fragment in the URL
		// callbackFragmentKey is wired directly into the default store — no manual store needed
		const callbackFragmentStoreA = createBackendOidcModeCallbackFragmentStore({
			sessionStorage: sharedSessionStore,
			key: keyA,
		});
		const resultA = await bootstrapBackendOidcModePageClient(clientA, {
			environment: createPageCallbackEnvironment(
				"https://app.example.com/#access_token=a-at&id_token=a-idt&refresh_token=a-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-a",
				callbackFragmentStoreA,
			),
		});
		expect(resultA.source).toBe(BackendOidcModeBootstrapSource.Callback);
		expect(resultA.snapshot?.tokens.accessToken).toBe("a-at");

		const clientB = createBackendOidcModeWebClient({
			span: createRootSpan(),
			baseUrl: "https://auth.example.com",
			persistentStateKey: "tenant-b",
			persistentStorage: sharedPersistentStore,
			sessionStorage: sharedSessionStore,
			transport: makeTransport("bob"),
			time: testTime,
		});

		// Integration B bootstraps on a plain URL — should see Empty, not A's callback
		const callbackFragmentStoreB = createBackendOidcModeCallbackFragmentStore({
			sessionStorage: sharedSessionStore,
			key: keyB,
		});
		const resultB = await bootstrapBackendOidcModePageClient(clientB, {
			environment: createPageCallbackEnvironment(
				"https://app.example.com/",
				callbackFragmentStoreB,
			),
		});
		// B must not see A's fragment — correct isolation means Empty, not Callback
		expect(resultB.source).toBe(BackendOidcModeBootstrapSource.Empty);
	});
	it("uses redirect: manual by default when no custom external transport is provided", async () => {
		const capturedInits: RequestInit[] = [];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async (
			_input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			capturedInits.push(init ?? {});
			return new Response(
				JSON.stringify({
					metadata: {
						principal: { subject: "user-1", displayName: "Alice" },
					},
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		};

		try {
			const client = createBackendOidcModeWebClient({
				span: createRootSpan(),
				persistentStorage: createInMemoryRecordStore(),
				sessionStorage: createInMemoryRecordStore(),
				time: testTime,
			});

			await client.handleCallback(
				"access_token=at&id_token=idt&metadata_redemption_id=meta-1",
			);

			// The default fetch transport must use redirect: "manual".
			expect(capturedInits.length).toBeGreaterThanOrEqual(1);
			expect(capturedInits[0]?.redirect).toBe("manual");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("uses a custom external transport when provided", async () => {
		const requests: HttpRequest[] = [];
		const customTransport = {
			async execute(request: HttpRequest): Promise<HttpResponse> {
				requests.push(request);
				if (request.url.endsWith("/metadata/redeem")) {
					return {
						status: 200,
						headers: {},
						body: {
							metadata: {
								principal: { subject: "user-1", displayName: "Alice" },
							},
						},
					};
				}

				throw new Error(`Unexpected: ${request.url}`);
			},
		};

		const client = createBackendOidcModeWebClient({
			span: createRootSpan(),
			persistentStorage: createInMemoryRecordStore(),
			sessionStorage: createInMemoryRecordStore(),
			time: testTime,
			transport: customTransport,
		});

		await client.handleCallback(
			"access_token=at&id_token=idt&metadata_redemption_id=meta-1",
		);

		// The custom transport handled the request, not the fetch transport.
		expect(requests.length).toBeGreaterThanOrEqual(1);
		expect(requests[0]?.url).toContain("/metadata/redeem");
	});

	it("resets namespaced callback fragments through an explicit fragment store", async () => {
		const sharedSessionStore = createInMemoryRecordStore();
		const keyA = resolveBackendOidcModeCallbackFragmentKey("tenant-a");
		const keyB = resolveBackendOidcModeCallbackFragmentKey("tenant-b");

		// Seed a callback fragment for integration A
		const storeA = createBackendOidcModeCallbackFragmentStore({
			sessionStorage: sharedSessionStore,
			key: keyA,
		});
		await storeA.save("access_token=a-at&id_token=a-idt");

		// Seed a callback fragment for integration B
		const storeB = createBackendOidcModeCallbackFragmentStore({
			sessionStorage: sharedSessionStore,
			key: keyB,
		});
		await storeB.save("access_token=b-at&id_token=b-idt");

		// Reset only integration A using the host-composed fragment store.
		const clientA = createBackendOidcModeWebClient({
			span: createRootSpan(),
			persistentStateKey: "tenant-a",
			persistentStorage: createInMemoryRecordStore(),
			sessionStorage: sharedSessionStore,
			transport: {
				async execute(): Promise<HttpResponse> {
					throw new Error("should not be called");
				},
			},
		});

		await resetBackendOidcModeBrowserState(clientA, {
			callbackFragmentStore: storeA,
		});

		// Integration A's fragment must be cleared
		expect(await storeA.load()).toBeNull();
		// Integration B's fragment must be untouched
		expect(await storeB.load()).toBe("access_token=b-at&id_token=b-idt");
	});

	it("reset requires an explicit callbackFragmentStore and leaves unrelated stores untouched", async () => {
		const sessionStorage = createInMemoryRecordStore();
		const explicitStore = createBackendOidcModeCallbackFragmentStore({
			sessionStorage,
			key: "explicit-key",
		});
		await explicitStore.save("access_token=explicit-at&id_token=explicit-idt");

		// Also seed a fragment under a different key
		const otherStore = createBackendOidcModeCallbackFragmentStore({
			sessionStorage,
			key: "other-key",
		});
		await otherStore.save("access_token=other-at&id_token=other-idt");

		const client = createBackendOidcModeWebClient({
			span: createRootSpan(),
			persistentStorage: createInMemoryRecordStore(),
			sessionStorage,
			transport: {
				async execute(): Promise<HttpResponse> {
					throw new Error("should not be called");
				},
			},
		});

		await resetBackendOidcModeBrowserState(client, {
			callbackFragmentStore: explicitStore,
		});

		expect(await explicitStore.load()).toBeNull();
		expect(await otherStore.load()).toBe(
			"access_token=other-at&id_token=other-idt",
		);

		await expect(
			resetBackendOidcModeBrowserState(client, {} as never),
		).rejects.toThrow(/callbackFragmentStore/);
	});

	it("materialized backend web clients and the compatibility helper share the same redirect navigation path", async () => {
		const client = createBackendOidcModeWebClient({
			span: createRootSpan(),
			persistentStorage: createInMemoryRecordStore(),
			sessionStorage: createInMemoryRecordStore(),
			baseUrl: "https://auth.example.com",
		});
		const sharedLocation = {
			href: "https://app.example.com/page",
			hash: "",
			pathname: "/page",
			search: "",
		};
		const sharedEnvironment = createRouterForNativeWeb({
			location: sharedLocation,
		});
		const compatibilityLocation = {
			href: "https://app.example.com/other-page",
			hash: "",
			pathname: "/other-page",
			search: "",
		};
		const compatibilityEnvironment = createRouterForNativeWeb({
			location: compatibilityLocation,
		});
		await client.loginWithRedirect({
			environment: sharedEnvironment,
			postAuthRedirectUri: "https://app.example.com/return",
		});
		loginWithBackendOidcRedirect(client, {
			environment: compatibilityEnvironment,
			postAuthRedirectUri: "https://app.example.com/return",
		});

		expect(sharedLocation.href).toBe(
			"https://auth.example.com/auth/oidc/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Freturn",
		);
		expect(compatibilityLocation.href).toBe(
			"https://auth.example.com/auth/oidc/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Freturn",
		);
	});

	it("fails page helpers without explicit environment instead of reading a global window", async () => {
		const client = createBackendOidcModeWebClient({
			span: createRootSpan(),
			persistentStorage: createInMemoryRecordStore(),
			sessionStorage: createInMemoryRecordStore(),
			transport: {
				async execute(): Promise<HttpResponse> {
					throw new Error("transport should not be called");
				},
			},
		});
		const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			"window",
		);
		let windowRead = false;

		Object.defineProperty(globalThis, "window", {
			configurable: true,
			get() {
				windowRead = true;
				return {
					location: {
						href: "https://app.example.com/oidc-mediated#fragment",
						hash: "#fragment",
					},
					history: { replaceState() {} },
				};
			},
		});

		try {
			expect(() => loginWithBackendOidcRedirect(client)).toThrow(
				/createEnvironmentForNativeWeb/,
			);
			await expect(
				loginWithBackendOidcPopup(
					client as never,
					{
						popupCallbackUrl: "https://app.example.com/popup-callback",
					} as never,
				),
			).rejects.toThrow(/callbackFragmentStore/);
			expect(() => relayBackendOidcPopupCallback()).toThrow(
				/createEnvironmentForNativeWeb/,
			);
			await expect(bootstrapBackendOidcModePageClient(client)).rejects.toThrow(
				/createBackendOidcModeWebClientEnvironment/,
			);
			expect(windowRead).toBe(false);
		} finally {
			vi.unstubAllGlobals();
			if (originalWindowDescriptor) {
				Object.defineProperty(globalThis, "window", originalWindowDescriptor);
			} else {
				Reflect.deleteProperty(globalThis, "window");
			}
		}
	});
});
