import {
	ClientErrorKind,
	createInMemoryRecordStore,
} from "@securitydept/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createFrontendOidcModeBrowserClient,
	createFrontendOidcModeWebClientEnvironment,
} from "../config-source-web";

function createJsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("frontend-oidc-mode browser materialization", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("materializes a frontend OIDC client from config bootstrap plus runtime capabilities", async () => {
		Object.defineProperty(globalThis, "window", {
			value: {
				location: { origin: "https://app.example.com" },
			},
			configurable: true,
			writable: true,
		});
		const fetchMock = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			expect(url).toContain(
				"redirect_uri=https%3A%2F%2Fapp.example.com%2Fauth%2Ftoken-set%2Ffrontend-mode%2Fcallback",
			);
			return createJsonResponse(200, {
				clientId: "spa-client",
				redirectUrl: "https://server.example.com/ignored-by-override",
				issuerUrl: "https://issuer.example.com",
				authorizationEndpoint: "https://issuer.example.com/authorize",
				tokenEndpoint: "https://issuer.example.com/token",
				generatedAt: 123,
			});
		});
		vi.stubGlobal("fetch", fetchMock);
		const environment = createFrontendOidcModeWebClientEnvironment({
			persistentStoragePrefix: "apps.webui.token-set-frontend:persistent:",
			persistentStore: createInMemoryRecordStore(),
			sessionStore: createInMemoryRecordStore(),
		});

		const materialized = await createFrontendOidcModeBrowserClient({
			configEndpoint: "/api/auth/token-set/frontend-mode/config",
			redirectUri:
				"https://app.example.com/auth/token-set/frontend-mode/callback",
			defaultPostAuthRedirectUri: "/dashboard",
			environment,
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(materialized.config).toMatchObject({
			clientId: "spa-client",
			issuer: "https://issuer.example.com",
			redirectUri:
				"https://app.example.com/auth/token-set/frontend-mode/callback",
			defaultPostAuthRedirectUri: "/dashboard",
		});
		expect(materialized.browserPersistentStorageKey).toBe(
			"apps.webui.token-set-frontend:persistent:securitydept.frontend_oidc:v1:https://issuer.example.com:spa-client",
		);
		expect(materialized.resolvedProjection).toMatchObject({
			sourceKind: "network",
			generatedAt: 123,
		});
		expect(materialized.client.state.get()).toBeNull();
	});

	it("preserves config projection error envelopes as ClientError", async () => {
		Object.defineProperty(globalThis, "window", {
			value: {
				location: { origin: "https://app.example.com" },
			},
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
						recovery: "reauthenticate",
					},
				}),
			),
		);
		const environment = createFrontendOidcModeWebClientEnvironment();

		await expect(
			createFrontendOidcModeBrowserClient({
				configEndpoint: "/api/auth/token-set/frontend-mode/config",
				redirectUri:
					"https://app.example.com/auth/token-set/frontend-mode/callback",
				environment,
			}),
		).rejects.toMatchObject({
			name: "ClientError",
			kind: ClientErrorKind.Unauthenticated,
			code: "frontend_oidc.config_projection_failed",
		});
	});

	it("fails without an explicit environment without reading browser globals", async () => {
		const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			"window",
		);
		const originalFetchDescriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			"fetch",
		);
		let windowRead = false;
		let fetchRead = false;

		Object.defineProperty(globalThis, "window", {
			configurable: true,
			get() {
				windowRead = true;
				return {
					location: { origin: "https://implicit.example.com" },
				};
			},
		});
		Object.defineProperty(globalThis, "fetch", {
			configurable: true,
			get() {
				fetchRead = true;
				return vi.fn();
			},
		});

		try {
			await expect(
				createFrontendOidcModeBrowserClient({
					configEndpoint: "/api/auth/token-set/frontend-mode/config",
					redirectUri:
						"https://app.example.com/auth/token-set/frontend-mode/callback",
				} as never),
			).rejects.toThrow(/createFrontendOidcModeWebClientEnvironment/);
			expect(windowRead).toBe(false);
			expect(fetchRead).toBe(false);
		} finally {
			if (originalWindowDescriptor) {
				Object.defineProperty(globalThis, "window", originalWindowDescriptor);
			} else {
				Reflect.deleteProperty(globalThis, "window");
			}
			if (originalFetchDescriptor) {
				Object.defineProperty(globalThis, "fetch", originalFetchDescriptor);
			} else {
				Reflect.deleteProperty(globalThis, "fetch");
			}
		}
	});
});
