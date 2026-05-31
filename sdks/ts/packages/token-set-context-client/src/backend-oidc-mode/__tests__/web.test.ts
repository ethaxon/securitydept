import {
	createFoundationEnvironment,
	createInMemoryRecordStore,
	createRootSpan,
	createTracing,
	type HttpRequest,
	type HttpResponse,
	type TimeTrait,
	takeCompatFragmentFromRouter,
} from "@securitydept/client";
import { createRouterForNativeWeb } from "@securitydept/client/web";
import { describe, expect, it } from "vitest";
import { BackendOidcModeClient } from "../client/client";
import { type BackendOidcModeClientConfig } from "../client/types";

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

const testTime: TimeTrait = {
	now: () => Date.parse("2026-01-01T00:00:00Z"),
	setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
	clearTimeout: (handle) =>
		globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

function createTokenSetTransport(): {
	execute(request: HttpRequest): Promise<HttpResponse>;
} {
	return {
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
}

function createBackendOidcModeTestClient(options: {
	baseUrl?: string;
	persistence?: BackendOidcModeClientConfig["persistence"];
	persistentStorage?: ReturnType<typeof createInMemoryRecordStore>;
	sessionStorage?: ReturnType<typeof createInMemoryRecordStore>;
	transport?: { execute(request: HttpRequest): Promise<HttpResponse> };
	router?: ReturnType<typeof createRouterForNativeWeb>;
}) {
	return new BackendOidcModeClient(
		{
			baseUrl: options.baseUrl ?? "https://auth.example.com",
			persistence: options.persistence,
		},
		createFoundationEnvironment({
			persistentStorage:
				options.persistentStorage ?? createInMemoryRecordStore(),
			sessionStorage: options.sessionStorage ?? createInMemoryRecordStore(),
			transport: options.transport ?? createTokenSetTransport(),
			span: createRootSpan(),
			tracing: createTracing(),
			time: testTime,
			router: options.router,
		}),
	);
}

describe("token-set backend OIDC web helpers", () => {
	it("takes compat fragments from router once and preserves route hash", async () => {
		const history = createHistoryRecorder();
		const router = createRouterForNativeWeb({
			location: {
				href: "https://app.example.com/oidc-mediated?tab=demo#/route#securitydept=v1&access_token=callback-at&id_token=callback-idt",
				hash: "#/route#securitydept=v1&access_token=callback-at&id_token=callback-idt",
			},
			history,
		});
		if (router === null) {
			throw new Error("Expected native web router.");
		}

		const fragment = await takeCompatFragmentFromRouter(router);

		expect(fragment?.payload).toBe(
			"access_token=callback-at&id_token=callback-idt",
		);
		expect(history.replacedUrl).toBe(
			"https://app.example.com/oidc-mediated?tab=demo#/route",
		);
	});

	it("lets callers pass a taken fragment directly to handleCallback", async () => {
		const client = createBackendOidcModeTestClient({});
		const router = createRouterForNativeWeb({
			location: {
				href: "https://app.example.com/oidc-mediated#securitydept=v1&access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&metadata_redemption_id=meta-1",
				hash: "#securitydept=v1&access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&metadata_redemption_id=meta-1",
			},
			history: createHistoryRecorder(),
		});
		if (router === null) {
			throw new Error("Expected native web router.");
		}
		const fragment = await takeCompatFragmentFromRouter(router);

		const snapshot = await client.handleCallback(fragment?.parameters ?? {});

		expect(snapshot.tokens.accessToken).toBe("callback-at");
		expect(snapshot.metadata.principal?.displayName).toBe("Alice");
		expect(expectReplayValue(client.authSnapshot)?.tokens.accessToken).toBe(
			"callback-at",
		);
	});

	it("restores persisted auth when no callback fragment is present", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const firstClient = createBackendOidcModeTestClient({
			persistentStorage,
			sessionStorage,
		});
		await firstClient.handleCallback(
			callbackParameters(
				"access_token=seed-at&id_token=seed-idt&refresh_token=seed-rt&metadata_redemption_id=meta-1",
			),
		);

		const restoredClient = createBackendOidcModeTestClient({
			persistentStorage,
			sessionStorage,
		});
		const restored = await restoredClient.start();

		expect(restored?.tokens.accessToken).toBe("seed-at");
	});

	it("builds authorize URLs from the full current page URL", () => {
		const client = createBackendOidcModeTestClient({});
		const router = createRouterForNativeWeb({
			location: {
				href: "https://app.example.com/page?tab=demo#ignored",
				hash: "#ignored",
			},
		});
		if (router === null) {
			throw new Error("Expected native web router.");
		}
		const currentUrl = router.currentUrl();

		const authorizeUrl = client.authorizeUrl(currentUrl?.toString());

		expect(authorizeUrl).toBe(
			"https://auth.example.com/auth/oidc/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fpage%3Ftab%3Ddemo%23ignored",
		);
	});

	it("materialized backend web clients use their environment router for redirect navigation", async () => {
		const sharedLocation = {
			href: "https://app.example.com/page",
			hash: "",
			pathname: "/page",
			search: "",
		};
		const client = createBackendOidcModeTestClient({
			router: createRouterForNativeWeb({ location: sharedLocation }),
		});

		await client.loginWithRedirect({
			postAuthRedirectUri: "https://app.example.com/return",
		});

		expect(sharedLocation.href).toBe(
			"https://auth.example.com/auth/oidc/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Freturn",
		);
	});

	it("exposes the current bearer authorization header", async () => {
		const client = createBackendOidcModeTestClient({});
		await client.restoreState({
			tokens: {
				accessToken: "token-set-at",
				idToken: "id-token",
			},
			metadata: {},
		});

		await expect(client.authorizationHeaderValue.whenValue()).resolves.toBe(
			"Bearer token-set-at",
		);
	});
});
