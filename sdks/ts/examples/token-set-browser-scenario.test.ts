import { createInMemoryRecordStore } from "@securitydept/client";
import {
	FakeClock,
	FakeScheduler,
	FakeTransport,
} from "@securitydept/test-utils";
import {
	bootstrapTokenSetClient,
	createTokenSetBrowserClient,
	createTokenSetCallbackFragmentStore,
	TokenSetBootstrapSource,
} from "@securitydept/token-set-context-client/web";
import { describe, expect, it } from "vitest";

function createHistoryRecorder() {
	return {
		replacedUrl: "" as string,
		replaceState(_data: unknown, _unused: string, url?: string) {
			this.replacedUrl = url ?? "";
		},
	};
}

describe("external token-set browser scenario", () => {
	it("supports bootstrap, callback handling, refresh, and disposal from browser-facing entry points", async () => {
		const persistentStore = createInMemoryRecordStore();
		const sessionStore = createInMemoryRecordStore();
		const clock = new FakeClock(Date.parse("2026-01-01T00:00:00Z"));
		const scheduler = new FakeScheduler(clock);
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
					status: 302,
					headers: {
						location:
							"https://app.example.com/token-set#access_token=refreshed-at&refresh_token=refreshed-rt&expires_at=2026-01-01T00%3A10%3A00Z",
					},
					body: null,
				}),
			);
		const client = createTokenSetBrowserClient({
			baseUrl: "https://auth.example.com",
			defaultPostAuthRedirectUri: "https://app.example.com/token-set",
			persistentStore,
			sessionStore,
			transport,
			clock,
			scheduler,
		});
		const callbackFragmentStore =
			createTokenSetCallbackFragmentStore(sessionStore);

		const emptyBootstrap = await bootstrapTokenSetClient(client, {
			location: {
				href: "https://app.example.com/token-set",
				hash: "",
			},
			history: createHistoryRecorder(),
			callbackFragmentStore,
		});

		expect(emptyBootstrap).toEqual({
			source: TokenSetBootstrapSource.Empty,
			snapshot: null,
		});

		const callbackHistory = createHistoryRecorder();
		const callbackBootstrap = await bootstrapTokenSetClient(client, {
			location: {
				href: "https://app.example.com/token-set?tab=demo#access_token=callback-at&refresh_token=callback-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-1",
				hash: "#access_token=callback-at&refresh_token=callback-rt&expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-1",
			},
			history: callbackHistory,
			callbackFragmentStore,
		});

		expect(callbackBootstrap.source).toBe(TokenSetBootstrapSource.Callback);
		expect(callbackBootstrap.snapshot?.tokens.accessToken).toBe("callback-at");
		expect(callbackBootstrap.snapshot?.metadata.principal?.displayName).toBe(
			"Alice",
		);
		expect(callbackHistory.replacedUrl).toBe("/token-set?tab=demo");
		expect(client.authorizationHeader()).toBe("Bearer callback-at");

		const refreshed = await client.refresh();

		expect(refreshed?.tokens.accessToken).toBe("refreshed-at");
		expect(refreshed?.tokens.refreshMaterial).toBe("refreshed-rt");
		expect(client.state.get()?.tokens.accessToken).toBe("refreshed-at");

		client.dispose();

		expect(client.state.get()).toBeNull();
	});
});
