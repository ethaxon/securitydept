import {
	createInMemoryRecordStore,
	createRootSpan,
	createTracing,
} from "@securitydept/client";
import { createRouterForNativeWeb } from "@securitydept/client/web";
import { FakeTimeConfig, FakeTransport } from "@securitydept/test-utils";
import {
	BackendOidcModeBootstrapSource,
	type BootstrapBackendOidcModePageClientOptions,
	bootstrapBackendOidcModePageClient,
	type CreateBackendOidcModeCallbackFragmentStoreOptions,
	createBackendOidcModeCallbackFragmentStore,
	createBackendOidcModeWebClient,
	createBackendOidcModeWebClientEnvironment,
} from "@securitydept/token-set-context-client/backend-oidc-mode/web";
import { describe, expect, it } from "vitest";

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

describe("external backend-oidc-mode browser scenario", () => {
	it("supports bootstrap, callback handling, refresh, and disposal from browser-facing entry points", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const time = new FakeTimeConfig(Date.parse("2026-01-01T00:00:00Z"));
		const transport = new FakeTransport()
			.on(
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
			)
			.on(
				(request) => request.url.endsWith("/refresh"),
				() => ({
					status: 200,
					headers: { "content-type": "application/json" },
					body: {
						access_token: "refreshed-at",
						refresh_token: "refreshed-rt",
						access_token_expires_at: "2026-01-01T00:10:00Z",
					},
				}),
			);
		const client = createBackendOidcModeWebClient({
			environment: createBackendOidcModeWebClientEnvironment({
				span: createRootSpan(),
				tracing: createTracing(),
				persistentStorage,
				sessionStorage,
				transport: transport,
				time,
			}),
			baseUrl: "https://auth.example.com",
			defaultPostAuthRedirectUri: "https://app.example.com/oidc-mediated",
		});
		const fragmentStoreOptions: CreateBackendOidcModeCallbackFragmentStoreOptions =
			{ sessionStorage };
		const callbackFragmentStore =
			createBackendOidcModeCallbackFragmentStore(fragmentStoreOptions);

		const emptyBootstrapOptions: BootstrapBackendOidcModePageClientOptions = {
			environment: {
				...createRouterForNativeWeb({
					location: {
						href: "https://app.example.com/oidc-mediated",
						hash: "",
					},
					history: createHistoryRecorder(),
				}),
				callbackFragmentStore,
				time,
			},
		};
		const emptyBootstrap = await bootstrapBackendOidcModePageClient(
			client,
			emptyBootstrapOptions,
		);

		expect(emptyBootstrap).toEqual({
			source: BackendOidcModeBootstrapSource.Empty,
			snapshot: null,
		});

		const callbackHistory = createHistoryRecorder();
		const callbackBootstrap = await bootstrapBackendOidcModePageClient(client, {
			environment: {
				...createRouterForNativeWeb({
					location: {
						href: "https://app.example.com/oidc-mediated?tab=demo#access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-1",
						hash: "#access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-1",
					},
					history: callbackHistory,
				}),
				callbackFragmentStore,
				time,
			},
		});

		expect(callbackBootstrap.source).toBe(
			BackendOidcModeBootstrapSource.Callback,
		);
		expect(callbackBootstrap.snapshot?.tokens.accessToken).toBe("callback-at");
		expect(callbackBootstrap.snapshot?.metadata.principal?.displayName).toBe(
			"Alice",
		);
		expect(callbackHistory.replacedUrl).toBe("/oidc-mediated?tab=demo");
		expect(expectReplayValue(client.authorizationHeaderValue)).toBe(
			"Bearer callback-at",
		);

		const refreshed = await client.refreshState();

		expect(refreshed?.tokens.accessToken).toBe("refreshed-at");
		expect(refreshed?.tokens.refreshMaterial).toBe("refreshed-rt");
		expect(expectReplayValue(client.authSnapshot)?.tokens.accessToken).toBe(
			"refreshed-at",
		);

		client.dispose();

		expect(expectReplayValue(client.authSnapshot)).toBeNull();
	});
});
