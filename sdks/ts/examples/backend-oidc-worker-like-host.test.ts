import {
	createClientEnvironment,
	createInMemoryRecordStore,
} from "@securitydept/client";
import { createRouterForNativeWeb } from "@securitydept/client/web";
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

function createTime() {
	return {
		now: () => Date.parse("2026-01-01T00:00:00Z"),
		setTimeout: (callback: () => void, delayMs: number) =>
			globalThis.setTimeout(callback, delayMs),
		clearTimeout: (handle: unknown) =>
			globalThis.clearTimeout(
				handle as ReturnType<typeof globalThis.setTimeout>,
			),
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

		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStorage,
		});
		const client = createBackendOidcModeWebClient({
			environment: createBackendOidcModeWebClientEnvironment({
				persistentStorage,
				sessionStorage,
				callbackFragmentStore,
				transport: createMetadataTransport(),
				time: createTime(),
			}),
		});

		await expect(bootstrapBackendOidcModePageClient(client)).rejects.toThrow(
			/createBackendOidcModeWebClientEnvironment/,
		);

		vi.unstubAllGlobals();
	});

	it("restores persisted token state without running page callback capture", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const baseEnvironment = createClientEnvironment({
			transport: createMetadataTransport(),
			persistentStorage,
			sessionStorage,
			time: createTime(),
		});
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStorage,
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
		expect(
			expectReplayValue(restoreClient.authSnapshot)?.metadata.principal
				?.displayName,
		).toBe("Worker User");
	});

	it("captures callback fragments only with explicit host-injected page capabilities", async () => {
		const callbackFragmentStore = createBackendOidcModeCallbackFragmentStore({
			sessionStorage: createInMemoryRecordStore(),
		});
		const history = {
			replacedUrl: "",
			replaceState(_data: unknown, _unused: string, url?: string) {
				this.replacedUrl = url ?? "";
			},
		};

		const fragment = await captureBackendOidcModeCallbackFragment({
			environment: {
				...createRouterForNativeWeb({
					location: {
						href: "https://app.example.com/popup#access_token=popup-at&id_token=popup-idt",
						hash: "#access_token=popup-at&id_token=popup-idt",
					},
					history,
				}),
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
