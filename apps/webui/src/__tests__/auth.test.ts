// @vitest-environment jsdom

import {
	ClientErrorKind,
	readErrorPresentationDescriptor,
	UserRecovery,
} from "@securitydept/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

class MemoryStorage {
	private readonly _data = new Map<string, string>();

	getItem(key: string): string | null {
		return this._data.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this._data.set(key, value);
	}

	removeItem(key: string): void {
		this._data.delete(key);
	}

	clear(): void {
		this._data.clear();
	}
}

function createJsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("webui auth smoke", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
		Object.defineProperty(globalThis, "sessionStorage", {
			value: new MemoryStorage(),
			configurable: true,
			writable: true,
		});
		Object.defineProperty(globalThis, "localStorage", {
			value: new MemoryStorage(),
			configurable: true,
			writable: true,
		});
	});

	it("consumes pending redirect when resolving login URL", async () => {
		const { sessionContextClient } = await import("../lib/sessionContext");

		await sessionContextClient.savePendingLoginRedirect("/entries?tab=all");

		const firstRedirect =
			await sessionContextClient.consumePendingLoginRedirect();
		expect(sessionContextClient.loginUrl(firstRedirect ?? undefined)).toBe(
			"/auth/session/login?post_auth_redirect_uri=%2Fentries%3Ftab%3Dall",
		);

		const secondRedirect =
			await sessionContextClient.consumePendingLoginRedirect();
		expect(sessionContextClient.loginUrl(secondRedirect ?? undefined)).toBe(
			"/auth/session/login",
		);
	});

	it("stores and clears redirect intent via session helpers", async () => {
		const { sessionContextClient } = await import("../lib/sessionContext");

		await sessionContextClient.savePendingLoginRedirect("/groups?tab=members");
		expect(await sessionContextClient.loadPendingLoginRedirect()).toBe(
			"/groups?tab=members",
		);

		await sessionContextClient.clearPendingLoginRedirect();
		const redirect = await sessionContextClient.consumePendingLoginRedirect();
		expect(sessionContextClient.loginUrl(redirect ?? undefined)).toBe(
			"/auth/session/login",
		);
	});

	it("notifies auth-context subscribers through shared storage and custom-event bridges", async () => {
		const { AuthContextMode, setAuthContextMode, subscribeAuthContextMode } =
			await import("../lib/authContext");
		const listener = vi.fn();
		const unsubscribe = subscribeAuthContextMode(listener);

		window.dispatchEvent(
			new StorageEvent("storage", {
				key: "securitydept.webui.auth_context_mode",
				newValue: AuthContextMode.TokenSetFrontend,
			}),
		);
		expect(listener).toHaveBeenCalledTimes(1);

		setAuthContextMode(AuthContextMode.Basic);
		expect(listener).toHaveBeenCalledTimes(2);

		unsubscribe();
		window.dispatchEvent(
			new StorageEvent("storage", {
				key: "securitydept.webui.auth_context_mode",
				newValue: AuthContextMode.Session,
			}),
		);
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it("builds an explicit session login URL without consuming stored redirect intent", async () => {
		const { sessionContextClient } = await import("../lib/sessionContext");

		await sessionContextClient.savePendingLoginRedirect("/groups?tab=members");
		expect(sessionContextClient.loginUrl("/playground/session")).toBe(
			"/auth/session/login?post_auth_redirect_uri=%2Fplayground%2Fsession",
		);

		const redirect = await sessionContextClient.consumePendingLoginRedirect();
		expect(sessionContextClient.loginUrl(redirect ?? undefined)).toBe(
			"/auth/session/login?post_auth_redirect_uri=%2Fgroups%3Ftab%3Dmembers",
		);
	});

	it("fetchCurrentSession returns session when authenticated", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				createJsonResponse(200, {
					subject: "session-user-1",
					display_name: "Alice",
				}),
			),
		);
		const { sessionContextClient, sessionContextTransport } = await import(
			"../lib/sessionContext"
		);

		const session = await sessionContextClient.fetchUserInfo(
			sessionContextTransport,
		);
		expect(session).toEqual({
			principal: {
				subject: "session-user-1",
				displayName: "Alice",
				picture: undefined,
				issuer: undefined,
				claims: undefined,
			},
		});
	});

	it("fetchCurrentSession returns null when unauthenticated", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => createJsonResponse(401, { message: "unauthorized" })),
		);
		const { sessionContextClient, sessionContextTransport } = await import(
			"../lib/sessionContext"
		);

		const session = await sessionContextClient.fetchUserInfo(
			sessionContextTransport,
		);
		expect(session).toBeNull();
	});

	it("posts logout and clears redirect state", async () => {
		const fetchMock = vi.fn(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				if (String(input).endsWith("/auth/session/logout")) {
					expect(init?.method).toBe("POST");
					return createJsonResponse(200, {});
				}

				return createJsonResponse(500, { message: "unexpected" });
			},
		);
		vi.stubGlobal("fetch", fetchMock);
		const { sessionContextClient, sessionContextTransport } = await import(
			"../lib/sessionContext"
		);

		await sessionContextClient.savePendingLoginRedirect("/entries/new");
		await sessionContextClient.logout(sessionContextTransport);
		await sessionContextClient.clearPendingLoginRedirect();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const redirect = await sessionContextClient.consumePendingLoginRedirect();
		expect(sessionContextClient.loginUrl(redirect ?? undefined)).toBe(
			"/auth/session/login",
		);
	});

	it("maps structured auth envelopes into ClientError presentation for dashboard APIs", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				createJsonResponse(401, {
					status: 401,
					error: {
						kind: "unauthenticated",
						code: "propagation_auth_method_mismatch",
						message:
							"This request requires bearer token authentication for propagation.",
						recovery: UserRecovery.Reauthenticate,
						presentation: {
							code: "propagation_auth_method_mismatch",
							message:
								"This request requires bearer token authentication for propagation.",
							recovery: UserRecovery.Reauthenticate,
						},
					},
				}),
			),
		);

		const { api } = await import("../api/client");

		let failure: unknown;
		try {
			await api.get("/api/entries");
		} catch (error) {
			failure = error;
		}

		expect(failure).toMatchObject({
			name: "ClientError",
			kind: ClientErrorKind.Unauthenticated,
			presentation: {
				code: "propagation_auth_method_mismatch",
				message:
					"This request requires bearer token authentication for propagation.",
				recovery: UserRecovery.Reauthenticate,
			},
		});

		const descriptor = readErrorPresentationDescriptor(failure, {
			recoveryLinks: {
				[UserRecovery.Reauthenticate]: "/login",
			},
		});

		expect(descriptor.title).toBe("Authentication required");
		expect(descriptor.description).toBe(
			"This request requires bearer token authentication for propagation.",
		);
		expect(descriptor.primaryAction).toEqual({
			recovery: UserRecovery.Reauthenticate,
			label: "Sign in again",
			href: "/login",
		});
	});
});
