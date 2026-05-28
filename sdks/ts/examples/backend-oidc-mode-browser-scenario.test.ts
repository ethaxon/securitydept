import {
	createFoundationEnvironment,
	createInMemoryRecordStore,
	createRootSpan,
	createTracing,
	takeCompatFragmentFromRouter,
} from "@securitydept/client";
import { createRouterForNativeWeb } from "@securitydept/client/web";
import { FakeTimeConfig, FakeTransport } from "@securitydept/test-utils";
import { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
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
		const client = new BackendOidcModeClient(
			{
				baseUrl: "https://auth.example.com",
				defaultPostAuthRedirectUri: "https://app.example.com/oidc-mediated",
			},
			createFoundationEnvironment({
				span: createRootSpan(),
				tracing: createTracing(),
				persistentStorage,
				sessionStorage,
				transport: transport,
				time,
			}),
		);
		const emptySnapshot = await client.start();

		expect(emptySnapshot).toBeNull();

		const callbackHistory = createHistoryRecorder();
		const callbackFragment = await takeCompatFragmentFromRouter(
			createRouterForNativeWeb({
				location: {
					href: "https://app.example.com/oidc-mediated?tab=demo#/route#securitydept=v1&access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&access_token_expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-1",
					hash: "#/route#securitydept=v1&access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&access_token_expires_at=2026-01-01T00%3A05%3A00Z&metadata_redemption_id=meta-1",
				},
				history: callbackHistory,
			}),
		);
		const callbackSnapshot = await client.handleCallback(
			callbackFragment?.parameters ?? {},
		);

		expect(callbackSnapshot.tokens.accessToken).toBe("callback-at");
		expect(callbackSnapshot.metadata.principal?.displayName).toBe("Alice");
		expect(callbackHistory.replacedUrl).toBe(
			"https://app.example.com/oidc-mediated?tab=demo",
		);
		expect(expectReplayValue(client.authorizationHeaderValue)).toBe(
			"Bearer callback-at",
		);

		time.advance(5 * 60_000);
		const refreshed = await client.refreshState();

		expect(refreshed?.tokens.accessToken).toBe("refreshed-at");
		expect(refreshed?.tokens.refreshMaterial).toBe("refreshed-rt");
		expect(expectReplayValue(client.authSnapshot)?.tokens.accessToken).toBe(
			"refreshed-at",
		);

		client.dispose();
	});
});
