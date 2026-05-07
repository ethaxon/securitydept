import { createInMemoryRecordStore } from "@securitydept/client";
import { createBrowserExtensionBackgroundClientEnvironment } from "@securitydept/client/web";
import {
	BackendOidcModeBootstrapSource,
	bootstrapBackendOidcModePageClient,
	captureBackendOidcModeCallbackFragment,
	createBackendOidcModeCallbackFragmentStore,
	createBackendOidcModeWebClient,
	createBackendOidcModeWebClientEnvironment,
	restoreBackendOidcModeClient,
} from "@securitydept/token-set-context-client/backend-oidc-mode/web";
import { describe, expect, it, vi } from "vitest";

function createScheduler() {
	return {
		setTimeout() {
			return { cancel() {} };
		},
	};
}

function createMetadataTransport() {
	return {
		async execute() {
			return {
				status: 200,
				headers: {},
				body: {
					metadata: {
						principal: {
							subject: "worker-user",
							displayName: "Worker User",
						},
					},
				},
			};
		},
	};
}

describe("backend-oidc worker-like host boundary", () => {
	it("does not treat globalThis.location as a page callback environment", async () => {
		vi.stubGlobal("location", {
			href: "https://extension.example/background#access_token=at",
			hash: "#access_token=at",
		});

		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStore,
		});
		const client = createBackendOidcModeWebClient({
			environment: createBackendOidcModeWebClientEnvironment({
				persistentStore,
				sessionStore,
				callbackFragmentStore,
				transport: createMetadataTransport(),
				scheduler: createScheduler(),
				clock: { now: () => Date.parse("2026-01-01T00:00:00Z") },
			}),
		});

		await expect(bootstrapBackendOidcModePageClient(client)).rejects.toThrow(
			/createBackendOidcModeWebClientEnvironment/,
		);

		vi.unstubAllGlobals();
	});

	it("restores persisted token state without running page callback capture", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const baseEnvironment = createBrowserExtensionBackgroundClientEnvironment({
			transport: createMetadataTransport(),
			persistentStore,
			sessionStore,
			scheduler: createScheduler(),
			clock: { now: () => Date.parse("2026-01-01T00:00:00Z") },
		});
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStore,
		});
		const environment = { ...baseEnvironment, callbackFragmentStore };
		const callbackClient = createBackendOidcModeWebClient({ environment });

		await callbackClient.handleCallback(
			"access_token=worker-at&id_token=worker-idt&refresh_token=worker-rt&metadata_redemption_id=meta-worker",
		);
		const restoreClient = createBackendOidcModeWebClient({ environment });
		const result = await restoreBackendOidcModeClient(restoreClient);

		expect(result.source).toBe(BackendOidcModeBootstrapSource.Restore);
		expect(result.snapshot?.tokens.accessToken).toBe("worker-at");
		expect(restoreClient.state.get()?.metadata.principal?.displayName).toBe(
			"Worker User",
		);
	});

	it("captures callback fragments only with explicit host-injected page capabilities", async () => {
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStore: createInMemoryRecordStore(),
		});
		const history = {
			replacedUrl: "",
			replaceState(_data: unknown, _unused: string, url?: string) {
				this.replacedUrl = url ?? "";
			},
		};

		const fragment = await captureBackendOidcModeCallbackFragment({
			environment: {
				location: {
					href: "https://app.example.com/popup#access_token=popup-at&id_token=popup-idt",
					hash: "#access_token=popup-at&id_token=popup-idt",
				},
				history,
				callbackFragmentStore,
			},
		});

		expect(fragment).toBe("access_token=popup-at&id_token=popup-idt");
		expect(await callbackFragmentStore.load()).toBe(
			"access_token=popup-at&id_token=popup-idt",
		);
		expect(history.replacedUrl).toBe("/popup");
	});
});
