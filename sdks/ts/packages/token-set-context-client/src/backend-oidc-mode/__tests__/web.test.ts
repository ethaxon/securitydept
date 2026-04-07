import {
	ClientErrorKind,
	type Clock,
	createCancellationTokenSource,
	createInMemoryRecordStore,
	type HttpRequest,
	type HttpResponse,
	type LogEntry,
	LogLevel,
	type Scheduler,
	UserRecovery,
} from "@securitydept/client";
import { describe, expect, it } from "vitest";
import { createBackendOidcModeAuthorizedTransport } from "../auth-transport";
import {
	BackendOidcModeBootstrapSource,
	bootstrapBackendOidcModeClient,
	captureBackendOidcModeCallbackFragmentFromUrl,
	createBackendOidcModeBrowserClient,
	createBackendOidcModeCallbackFragmentStore,
	resetBackendOidcModeBrowserState,
	resolveBackendOidcModeCallbackFragmentKey,
} from "../web/browser";

function createHistoryRecorder() {
	return {
		replacedUrl: "" as string,
		replaceState(_data: unknown, _unused: string, url?: string) {
			this.replacedUrl = url ?? "";
		},
	};
}

const testClock: Clock = {
	now: () => Date.parse("2026-01-01T00:00:00Z"),
};

const testScheduler: Scheduler = {
	setTimeout() {
		return {
			cancel() {},
		};
	},
};

describe("token-set web helpers", () => {
	it("captures callback fragments and clears only the URL hash from history", async () => {
		const sessionStore = createInMemoryRecordStore();
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStore,
		});
		const history = createHistoryRecorder();

		const fragment = await captureBackendOidcModeCallbackFragmentFromUrl({
			location: {
				href: "https://app.example.com/oidc-mediated?tab=demo#access_token=callback-at&id_token=callback-idt",
				hash: "#access_token=callback-at&id_token=callback-idt",
			},
			history,
			callbackFragmentStore,
		});

		expect(fragment).toBe("access_token=callback-at&id_token=callback-idt");
		expect(await callbackFragmentStore.load()).toBe(
			"access_token=callback-at&id_token=callback-idt",
		);
		expect(history.replacedUrl).toBe("/oidc-mediated?tab=demo");
	});

	it("does not touch history when there is no callback fragment", async () => {
		const history = createHistoryRecorder();

		const fragment = await captureBackendOidcModeCallbackFragmentFromUrl({
			location: {
				href: "https://app.example.com/oidc-mediated?tab=demo",
				hash: "",
			},
			history,
		});

		expect(fragment).toBeNull();
		expect(history.replacedUrl).toBe("");
	});

	it("bootstraps browser client state from a callback fragment", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
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
		const client = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
			defaultPostAuthRedirectUri: "https://app.example.com/oidc-mediated",
		});
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStore,
		});

		const result = await bootstrapBackendOidcModeClient(client, {
			location: {
				href: "https://app.example.com/oidc-mediated#access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-1",
				hash: "#access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-1",
			},
			history: createHistoryRecorder(),
			callbackFragmentStore,
		});

		expect(result.source).toBe(BackendOidcModeBootstrapSource.Callback);
		expect(result.snapshot?.tokens.accessToken).toBe("callback-at");
		expect(await callbackFragmentStore.load()).toBeNull();
	});

	it("retains callback fragments when bootstrap fails with a retryable error", async () => {
		const sessionStore = createInMemoryRecordStore();
		const client = createBackendOidcModeBrowserClient({
			sessionStore,
			persistentStore: createInMemoryRecordStore(),
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
			sessionStore,
		});

		await expect(
			bootstrapBackendOidcModeClient(client, {
				location: {
					href: "https://app.example.com/oidc-mediated#access_token=callback-at&id_token=callback-idt&metadata_redemption_id=meta-1",
					hash: "#access_token=callback-at&id_token=callback-idt&metadata_redemption_id=meta-1",
				},
				history: createHistoryRecorder(),
				callbackFragmentStore,
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
		const sessionStore = createInMemoryRecordStore();
		const client = createBackendOidcModeBrowserClient({
			sessionStore,
			persistentStore: createInMemoryRecordStore(),
			transport: {
				async execute(): Promise<HttpResponse> {
					throw new Error("transport should not be called");
				},
			},
		});
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStore,
		});

		await expect(
			bootstrapBackendOidcModeClient(client, {
				location: {
					href: "https://app.example.com/oidc-mediated#refresh_token=callback-rt",
					hash: "#refresh_token=callback-rt",
				},
				history: createHistoryRecorder(),
				callbackFragmentStore,
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Protocol,
			code: "callback.missing_access_token",
		});
		expect(await callbackFragmentStore.load()).toBeNull();
	});

	it("resets browser state by clearing both callback fragments and persisted auth", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const client = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore,
			sessionStore,
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
			sessionStore,
		});

		await client.handleCallback(
			"access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&metadata_redemption_id=meta-1",
		);
		await callbackFragmentStore.save("access_token=pending-at");

		await resetBackendOidcModeBrowserState(client, { callbackFragmentStore });

		expect(client.state.get()).toBeNull();
		expect(await callbackFragmentStore.load()).toBeNull();

		const restoredClient = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore,
			sessionStore,
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
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
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
			sessionStore,
		});
		const firstClient = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
			defaultPostAuthRedirectUri: "https://app.example.com/oidc-mediated",
		});

		const callbackResult = await bootstrapBackendOidcModeClient(firstClient, {
			location: {
				href: "https://app.example.com/oidc-mediated#access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-1",
				hash: "#access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-1",
			},
			history: createHistoryRecorder(),
			callbackFragmentStore,
		});

		expect(callbackResult.source).toBe(BackendOidcModeBootstrapSource.Callback);
		expect(await callbackFragmentStore.load()).toBeNull();

		const restoredClient = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
		});

		const restoredResult = await bootstrapBackendOidcModeClient(
			restoredClient,
			{
				location: {
					href: "https://app.example.com/oidc-mediated",
					hash: "",
				},
				history: createHistoryRecorder(),
				callbackFragmentStore,
			},
		);

		expect(restoredResult.source).toBe(BackendOidcModeBootstrapSource.Restore);
		expect(restoredResult.snapshot?.tokens.accessToken).toBe("callback-at");
		expect(restoredClient.state.get()?.metadata.principal?.displayName).toBe(
			"Alice",
		);

		await resetBackendOidcModeBrowserState(restoredClient, {
			callbackFragmentStore,
		});

		const freshClient = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
		});

		const emptyResult = await bootstrapBackendOidcModeClient(freshClient, {
			location: {
				href: "https://app.example.com/oidc-mediated",
				hash: "",
			},
			history: createHistoryRecorder(),
			callbackFragmentStore,
		});

		expect(emptyResult).toEqual({
			source: BackendOidcModeBootstrapSource.Empty,
			snapshot: null,
		});
		expect(freshClient.state.get()).toBeNull();
		expect(await callbackFragmentStore.load()).toBeNull();
	});

	it("prefers a pending callback fragment over persisted auth and replaces the old state", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
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
			sessionStore,
		});
		const oldClient = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
		});

		await oldClient.handleCallback(
			"access_token=old-at&id_token=old-idt&refresh_token=old-rt&metadata_redemption_id=meta-old",
		);
		expect(oldClient.state.get()?.tokens.accessToken).toBe("old-at");

		const bootstrapClient = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
		});

		const callbackResult = await bootstrapBackendOidcModeClient(
			bootstrapClient,
			{
				location: {
					href: "https://app.example.com/oidc-mediated#access_token=new-at&id_token=new-idt&refresh_token=new-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-new",
					hash: "#access_token=new-at&id_token=new-idt&refresh_token=new-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-new",
				},
				history: createHistoryRecorder(),
				callbackFragmentStore,
			},
		);

		expect(callbackResult.source).toBe(BackendOidcModeBootstrapSource.Callback);
		expect(callbackResult.snapshot?.tokens.accessToken).toBe("new-at");
		expect(bootstrapClient.state.get()?.tokens.accessToken).toBe("new-at");
		expect(bootstrapClient.state.get()?.metadata.principal?.displayName).toBe(
			"New Alice",
		);
		expect(await callbackFragmentStore.load()).toBeNull();

		const restoredClient = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
		});

		const restoredResult = await bootstrapBackendOidcModeClient(
			restoredClient,
			{
				location: {
					href: "https://app.example.com/oidc-mediated",
					hash: "",
				},
				history: createHistoryRecorder(),
				callbackFragmentStore,
			},
		);

		expect(restoredResult.source).toBe(BackendOidcModeBootstrapSource.Restore);
		expect(restoredResult.snapshot?.tokens.accessToken).toBe("new-at");
		expect(restoredResult.snapshot?.tokens.accessToken).not.toBe("old-at");
		expect(restoredClient.state.get()?.metadata.principal?.displayName).toBe(
			"New Alice",
		);
	});

	it("keeps callback retry precedence over persisted auth until a later retry succeeds", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
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
			sessionStore,
		});
		const oldClient = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
		});

		await oldClient.handleCallback(
			"access_token=old-at&id_token=old-idt&refresh_token=old-rt&metadata_redemption_id=meta-old",
		);

		const retryingClient = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
		});

		await expect(
			bootstrapBackendOidcModeClient(retryingClient, {
				location: {
					href: "https://app.example.com/oidc-mediated#access_token=new-at&id_token=new-idt&refresh_token=new-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-new",
					hash: "#access_token=new-at&id_token=new-idt&refresh_token=new-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-new",
				},
				history: createHistoryRecorder(),
				callbackFragmentStore,
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Server,
			recovery: UserRecovery.Retry,
		});

		expect(await callbackFragmentStore.load()).toBe(
			"access_token=new-at&id_token=new-idt&refresh_token=new-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-new",
		);
		expect(retryingClient.state.get()).toBeNull();

		const recoveredResult = await bootstrapBackendOidcModeClient(
			retryingClient,
			{
				location: {
					href: "https://app.example.com/oidc-mediated",
					hash: "",
				},
				history: createHistoryRecorder(),
				callbackFragmentStore,
			},
		);

		expect(recoveredResult.source).toBe(
			BackendOidcModeBootstrapSource.Callback,
		);
		expect(recoveredResult.snapshot?.tokens.accessToken).toBe("new-at");
		expect(retryingClient.state.get()?.metadata.principal?.displayName).toBe(
			"New Alice",
		);
		expect(await callbackFragmentStore.load()).toBeNull();

		const restoredClient = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
		});

		const restoredResult = await bootstrapBackendOidcModeClient(
			restoredClient,
			{
				location: {
					href: "https://app.example.com/oidc-mediated",
					hash: "",
				},
				history: createHistoryRecorder(),
				callbackFragmentStore,
			},
		);

		expect(restoredResult.source).toBe(BackendOidcModeBootstrapSource.Restore);
		expect(restoredResult.snapshot?.tokens.accessToken).toBe("new-at");
		expect(restoredResult.snapshot?.tokens.accessToken).not.toBe("old-at");
	});

	it("clears non-retryable callback precedence and only restores old state on a later fresh bootstrap", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
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
			sessionStore,
		});
		const oldClient = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
		});

		await oldClient.handleCallback(
			"access_token=old-at&id_token=old-idt&refresh_token=old-rt&metadata_redemption_id=meta-old",
		);
		expect(oldClient.state.get()?.tokens.accessToken).toBe("old-at");

		const failingClient = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
		});

		await expect(
			bootstrapBackendOidcModeClient(failingClient, {
				location: {
					href: "https://app.example.com/oidc-mediated#access_token=bad-at&id_token=bad-idt&refresh_token=bad-rt&metadata_redemption_id=meta-bad",
					hash: "#access_token=bad-at&id_token=bad-idt&refresh_token=bad-rt&metadata_redemption_id=meta-bad",
				},
				history: createHistoryRecorder(),
				callbackFragmentStore,
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Protocol,
			retryable: false,
		});

		expect(await callbackFragmentStore.load()).toBeNull();
		expect(failingClient.state.get()).toBeNull();

		const restoredClient = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
		});

		const restoredResult = await bootstrapBackendOidcModeClient(
			restoredClient,
			{
				location: {
					href: "https://app.example.com/oidc-mediated",
					hash: "",
				},
				history: createHistoryRecorder(),
				callbackFragmentStore,
			},
		);

		expect(restoredResult.source).toBe(BackendOidcModeBootstrapSource.Restore);
		expect(restoredResult.snapshot?.tokens.accessToken).toBe("old-at");
		expect(restoredClient.state.get()?.metadata.principal?.displayName).toBe(
			"Old Alice",
		);
		expect(restoredResult.snapshot?.tokens.accessToken).not.toBe("bad-at");
	});

	it("replaces a retained pending fragment with the latest URL callback before bootstrap", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
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
			sessionStore,
		});

		await callbackFragmentStore.save(
			"access_token=old-at&id_token=old-idt&refresh_token=old-rt&metadata_redemption_id=meta-old",
		);

		const history = createHistoryRecorder();
		const capturedFragment =
			await captureBackendOidcModeCallbackFragmentFromUrl({
				location: {
					href: "https://app.example.com/oidc-mediated?tab=members#access_token=new-at&id_token=new-idt&refresh_token=new-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-new",
					hash: "#access_token=new-at&id_token=new-idt&refresh_token=new-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-new",
				},
				history,
				callbackFragmentStore,
			});

		expect(capturedFragment).toBe(
			"access_token=new-at&id_token=new-idt&refresh_token=new-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-new",
		);
		expect(await callbackFragmentStore.load()).toBe(
			"access_token=new-at&id_token=new-idt&refresh_token=new-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-new",
		);
		expect(history.replacedUrl).toBe("/oidc-mediated?tab=members");

		const bootstrapClient = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
		});

		const callbackResult = await bootstrapBackendOidcModeClient(
			bootstrapClient,
			{
				location: {
					href: "https://app.example.com/oidc-mediated?tab=members",
					hash: "",
				},
				history: createHistoryRecorder(),
				callbackFragmentStore,
			},
		);

		expect(callbackResult.source).toBe(BackendOidcModeBootstrapSource.Callback);
		expect(callbackResult.snapshot?.tokens.accessToken).toBe("new-at");
		expect(bootstrapClient.state.get()?.metadata.principal?.displayName).toBe(
			"Newest Alice",
		);
		expect(await callbackFragmentStore.load()).toBeNull();

		const restoredClient = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
		});

		const restoredResult = await bootstrapBackendOidcModeClient(
			restoredClient,
			{
				location: {
					href: "https://app.example.com/oidc-mediated?tab=members",
					hash: "",
				},
				history: createHistoryRecorder(),
				callbackFragmentStore,
			},
		);

		expect(restoredResult.source).toBe(BackendOidcModeBootstrapSource.Restore);
		expect(restoredResult.snapshot?.tokens.accessToken).toBe("new-at");
		expect(restoredResult.snapshot?.tokens.accessToken).not.toBe("old-at");
	});

	it("replaces a retry-retained pending fragment with the latest URL callback before recovery bootstrap", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
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
			sessionStore,
		});
		const retryingClient = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
		});

		await expect(
			bootstrapBackendOidcModeClient(retryingClient, {
				location: {
					href: "https://app.example.com/oidc-mediated#access_token=retry-at&id_token=retry-idt&refresh_token=retry-rt&metadata_redemption_id=meta-retry",
					hash: "#access_token=retry-at&id_token=retry-idt&refresh_token=retry-rt&metadata_redemption_id=meta-retry",
				},
				history: createHistoryRecorder(),
				callbackFragmentStore,
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Server,
			recovery: UserRecovery.Retry,
		});

		expect(await callbackFragmentStore.load()).toBe(
			"access_token=retry-at&id_token=retry-idt&refresh_token=retry-rt&metadata_redemption_id=meta-retry",
		);

		const history = createHistoryRecorder();
		const recoveredResult = await bootstrapBackendOidcModeClient(
			retryingClient,
			{
				location: {
					href: "https://app.example.com/oidc-mediated?tab=members#access_token=new-at&id_token=new-idt&refresh_token=new-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-new",
					hash: "#access_token=new-at&id_token=new-idt&refresh_token=new-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-new",
				},
				history,
				callbackFragmentStore,
			},
		);

		expect(history.replacedUrl).toBe("/oidc-mediated?tab=members");
		expect(recoveredResult.source).toBe(
			BackendOidcModeBootstrapSource.Callback,
		);
		expect(recoveredResult.snapshot?.tokens.accessToken).toBe("new-at");
		expect(retryingClient.state.get()?.metadata.principal?.displayName).toBe(
			"Newest Alice",
		);
		expect(await callbackFragmentStore.load()).toBeNull();

		const restoredClient = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
		});

		const restoredResult = await bootstrapBackendOidcModeClient(
			restoredClient,
			{
				location: {
					href: "https://app.example.com/oidc-mediated?tab=members",
					hash: "",
				},
				history: createHistoryRecorder(),
				callbackFragmentStore,
			},
		);

		expect(restoredResult.source).toBe(BackendOidcModeBootstrapSource.Restore);
		expect(restoredResult.snapshot?.tokens.accessToken).toBe("new-at");
		expect(restoredResult.snapshot?.tokens.accessToken).not.toBe("retry-at");
	});

	it("returns to empty after reset clears a latest-callback replacement state", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
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
			sessionStore,
		});

		await callbackFragmentStore.save(
			"access_token=old-at&id_token=old-idt&refresh_token=old-rt&metadata_redemption_id=meta-old",
		);

		const bootstrapClient = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
		});

		const callbackResult = await bootstrapBackendOidcModeClient(
			bootstrapClient,
			{
				location: {
					href: "https://app.example.com/oidc-mediated?tab=members#access_token=new-at&id_token=new-idt&refresh_token=new-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-new",
					hash: "#access_token=new-at&id_token=new-idt&refresh_token=new-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-new",
				},
				history: createHistoryRecorder(),
				callbackFragmentStore,
			},
		);

		expect(callbackResult.source).toBe(BackendOidcModeBootstrapSource.Callback);
		expect(callbackResult.snapshot?.tokens.accessToken).toBe("new-at");
		expect(await callbackFragmentStore.load()).toBeNull();

		await resetBackendOidcModeBrowserState(bootstrapClient, {
			callbackFragmentStore,
		});

		expect(bootstrapClient.state.get()).toBeNull();
		expect(await callbackFragmentStore.load()).toBeNull();

		const freshClient = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
		});

		const emptyResult = await bootstrapBackendOidcModeClient(freshClient, {
			location: {
				href: "https://app.example.com/oidc-mediated?tab=members",
				hash: "",
			},
			history: createHistoryRecorder(),
			callbackFragmentStore,
		});

		expect(emptyResult).toEqual({
			source: BackendOidcModeBootstrapSource.Empty,
			snapshot: null,
		});
		expect(freshClient.state.get()).toBeNull();
	});

	it("injects the current bearer and forwards cancellation tokens", async () => {
		const cancellation = createCancellationTokenSource();
		const requests: HttpRequest[] = [];
		const transport = createBackendOidcModeAuthorizedTransport(
			{
				authorizationHeader: () => "Bearer token-set-at",
			},
			{
				transport: {
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
		const transport = createBackendOidcModeAuthorizedTransport(
			{
				authorizationHeader: () => null,
			},
			{
				transport: {
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
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
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
		const clientA = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStateKey: "tenant-a",
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
		});

		await clientA.handleCallback(
			"access_token=a-at&id_token=a-idt&refresh_token=a-rt&metadata_redemption_id=meta-a",
		);
		expect(clientA.state.get()?.tokens.accessToken).toBe("a-at");

		// Client B: uses a different persistentStateKey on the same store
		const clientB = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStateKey: "tenant-b",
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
		});

		// Client B must NOT see Client A's state
		const restoredB = await clientB.restorePersistedState();
		expect(restoredB).toBeNull();

		// Client C: uses the same key as A — must see A's state
		const clientC = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStateKey: "tenant-a",
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
		});

		const restoredC = await clientC.restorePersistedState();
		expect(restoredC?.tokens.accessToken).toBe("a-at");
	});

	it("isolates callback fragments via callbackFragmentKey in the default bootstrap path", async () => {
		// Two integrations share a single in-memory session store (same origin scenario).
		// Each passes callbackFragmentKey to bootstrapBackendOidcModeClient so the
		// default fragment store is namespaced — no manual store construction required.
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

		const clientA = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStateKey: "tenant-a",
			persistentStore: sharedPersistentStore,
			sessionStore: sharedSessionStore,
			transport: makeTransport("alice"),
			clock: testClock,
			scheduler: testScheduler,
		});

		// Integration A bootstraps with a callback fragment in the URL
		// callbackFragmentKey is wired directly into the default store — no manual store needed
		const resultA = await bootstrapBackendOidcModeClient(clientA, {
			location: {
				href: "https://app.example.com/#access_token=a-at&id_token=a-idt&refresh_token=a-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-a",
				hash: "#access_token=a-at&id_token=a-idt&refresh_token=a-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-a",
			},
			history: createHistoryRecorder(),
			sessionStore: sharedSessionStore,
			callbackFragmentKey: keyA,
		});
		expect(resultA.source).toBe(BackendOidcModeBootstrapSource.Callback);
		expect(resultA.snapshot?.tokens.accessToken).toBe("a-at");

		const clientB = createBackendOidcModeBrowserClient({
			baseUrl: "https://auth.example.com",
			persistentStateKey: "tenant-b",
			persistentStore: sharedPersistentStore,
			sessionStore: sharedSessionStore,
			transport: makeTransport("bob"),
			clock: testClock,
			scheduler: testScheduler,
		});

		// Integration B bootstraps on a plain URL — should see Empty, not A's callback
		const resultB = await bootstrapBackendOidcModeClient(clientB, {
			location: {
				href: "https://app.example.com/",
				hash: "",
			},
			history: createHistoryRecorder(),
			sessionStore: sharedSessionStore,
			callbackFragmentKey: keyB,
		});
		// B must not see A's fragment — correct isolation means Empty, not Callback
		expect(resultB.source).toBe(BackendOidcModeBootstrapSource.Empty);
	});
	it("forwards logger through the browser entry and invokes it during real client behavior", async () => {
		const logEntries: LogEntry[] = [];
		const logger = {
			log(entry: LogEntry): void {
				logEntries.push(entry);
			},
		};
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
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

		const client = createBackendOidcModeBrowserClient({
			persistentStore,
			sessionStore,
			transport,
			clock: testClock,
			scheduler: testScheduler,
			logger,
		});

		await client.handleCallback(
			"access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&metadata_redemption_id=meta-1",
		);

		// The logger must have been called at least once with an Info-level
		// entry scoped to backend-oidc-mode during the callback lifecycle.
		const infoEntries = logEntries.filter(
			(e) => e.level === LogLevel.Info && e.scope === "backend-oidc-mode",
		);
		expect(infoEntries.length).toBeGreaterThanOrEqual(1);
		expect(infoEntries[0]?.message).toBe(
			"Auth state initialized from callback",
		);
	});

	it("uses redirect: manual by default when no transport or fetchTransport is provided", async () => {
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
			const client = createBackendOidcModeBrowserClient({
				persistentStore: createInMemoryRecordStore(),
				sessionStore: createInMemoryRecordStore(),
				clock: testClock,
				scheduler: testScheduler,
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

	it("forwards fetchTransport options to the default fetch transport", async () => {
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
			const client = createBackendOidcModeBrowserClient({
				persistentStore: createInMemoryRecordStore(),
				sessionStore: createInMemoryRecordStore(),
				clock: testClock,
				scheduler: testScheduler,
				// Override the SDK default redirect: "manual" → "follow"
				fetchTransport: { redirect: "follow" },
			});

			await client.handleCallback(
				"access_token=at&id_token=idt&metadata_redemption_id=meta-1",
			);

			// fetchTransport overrides the default — redirect must be "follow"
			expect(capturedInits.length).toBeGreaterThanOrEqual(1);
			expect(capturedInits[0]?.redirect).toBe("follow");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("ignores fetchTransport when a custom transport is provided", async () => {
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

		const client = createBackendOidcModeBrowserClient({
			persistentStore: createInMemoryRecordStore(),
			sessionStore: createInMemoryRecordStore(),
			clock: testClock,
			scheduler: testScheduler,
			transport: customTransport,
			// This should be completely ignored because transport is present.
			fetchTransport: { redirect: "follow" },
		});

		await client.handleCallback(
			"access_token=at&id_token=idt&metadata_redemption_id=meta-1",
		);

		// The custom transport handled the request, not the fetch transport.
		expect(requests.length).toBeGreaterThanOrEqual(1);
		expect(requests[0]?.url).toContain("/metadata/redeem");
	});

	it("resets namespaced callback fragments via callbackFragmentKey and sessionStore convenience path", async () => {
		const sharedSessionStore = createInMemoryRecordStore();
		const keyA = resolveBackendOidcModeCallbackFragmentKey("tenant-a");
		const keyB = resolveBackendOidcModeCallbackFragmentKey("tenant-b");

		// Seed a callback fragment for integration A
		const storeA = createBackendOidcModeCallbackFragmentStore({
			sessionStore: sharedSessionStore,
			key: keyA,
		});
		await storeA.save("access_token=a-at&id_token=a-idt");

		// Seed a callback fragment for integration B
		const storeB = createBackendOidcModeCallbackFragmentStore({
			sessionStore: sharedSessionStore,
			key: keyB,
		});
		await storeB.save("access_token=b-at&id_token=b-idt");

		// Reset only integration A using the convenience path
		const clientA = createBackendOidcModeBrowserClient({
			persistentStateKey: "tenant-a",
			persistentStore: createInMemoryRecordStore(),
			sessionStore: sharedSessionStore,
			transport: {
				async execute(): Promise<HttpResponse> {
					throw new Error("should not be called");
				},
			},
		});

		await resetBackendOidcModeBrowserState(clientA, {
			sessionStore: sharedSessionStore,
			callbackFragmentKey: keyA,
		});

		// Integration A's fragment must be cleared
		expect(await storeA.load()).toBeNull();
		// Integration B's fragment must be untouched
		expect(await storeB.load()).toBe("access_token=b-at&id_token=b-idt");
	});

	it("prefers callbackFragmentStore over callbackFragmentKey/sessionStore in reset", async () => {
		const sessionStore = createInMemoryRecordStore();
		const explicitStore = createBackendOidcModeCallbackFragmentStore({
			sessionStore,
			key: "explicit-key",
		});
		await explicitStore.save("access_token=explicit-at&id_token=explicit-idt");

		// Also seed a fragment under a different key
		const otherStore = createBackendOidcModeCallbackFragmentStore({
			sessionStore,
			key: "other-key",
		});
		await otherStore.save("access_token=other-at&id_token=other-idt");

		const client = createBackendOidcModeBrowserClient({
			persistentStore: createInMemoryRecordStore(),
			sessionStore,
			transport: {
				async execute(): Promise<HttpResponse> {
					throw new Error("should not be called");
				},
			},
		});

		// callbackFragmentStore takes priority — only explicit-key is cleared
		await resetBackendOidcModeBrowserState(client, {
			callbackFragmentStore: explicitStore,
			// These should be ignored because callbackFragmentStore is present
			callbackFragmentKey: "other-key",
			sessionStore,
		});

		expect(await explicitStore.load()).toBeNull();
		expect(await otherStore.load()).toBe(
			"access_token=other-at&id_token=other-idt",
		);
	});
});
