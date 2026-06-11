import {
	createFoundationEnvironment,
	createInMemoryRecordStore,
	createRootSpan,
	createTracing,
} from "@securitydept/client";
import {
	createTimeForTest,
	createTransportForTest,
} from "@securitydept/client/test";
import { createRouterForNativeWeb } from "@securitydept/client/web";
import {
	BackendOidcModeClient,
	BackendOidcModeCompatFragmentKind,
	takeBackendOidcCallbackInputFromRouter,
} from "@securitydept/token-set-context-client/backend-oidc-mode";
import { describe, expect, it } from "vitest";

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
		const time = createTimeForTest({
			initialNow: Date.parse("2026-01-01T00:00:00Z"),
		});
		const transport = createTransportForTest()
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
		const client = new BackendOidcModeClient(
			{
				baseUrl: "https://auth.example.com",
				defaultPostAuthRedirectUri: "https://app.example.com/oidc-mediated",
			},
			{
				environment: createFoundationEnvironment({
					span: createRootSpan(),
					tracing: createTracing(),
					persistentStorage,
					sessionStorage,
					transport: transport,
					time,
				}),
			},
		);
		const emptySnapshot = await client.start();

		expect(emptySnapshot).toBeNull();

		const callbackHistory = createHistoryRecorder();
		const callbackInput = await takeBackendOidcCallbackInputFromRouter(
			createRouterForNativeWeb({
				location: {
					href: `https://app.example.com/oidc-mediated?tab=demo#/route#securitydept=v1&kind=${BackendOidcModeCompatFragmentKind.Callback}&access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&access_token_expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-1`,
					hash: `#/route#securitydept=v1&kind=${BackendOidcModeCompatFragmentKind.Callback}&access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&access_token_expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-1`,
				},
				history: callbackHistory,
			})!,
		);
		const callbackSnapshot = await client.handleCallback(callbackInput ?? {});

		expect(callbackSnapshot.tokens.accessToken).toBe("callback-at");
		expect(callbackSnapshot.metadata.principal?.displayName).toBe("Alice");
		expect(callbackHistory.replacedUrl).toBe(
			"https://app.example.com/oidc-mediated?tab=demo#/route",
		);
		expect(client.authorizationHeaderValue.value.get()).toBe(
			"Bearer callback-at",
		);

		time.advance(5 * 60_000);
		const refreshed = await client.refreshState();

		expect(refreshed?.tokens.accessToken).toBe("refreshed-at");
		expect(refreshed?.tokens.refreshMaterial).toBe("refreshed-rt");
		expect(client.authResource.value.get()?.tokens.accessToken).toBe(
			"refreshed-at",
		);

		client.dispose();
	});
});
