// @vitest-environment jsdom

import {
	ClientErrorKind,
	createBaseTransportForStdFetch,
	createFoundationEnvironment,
	readErrorPresentationDescriptor,
	UserRecovery,
} from "@securitydept/client";
import { SessionContextClient } from "@securitydept/session-context-client";
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
		const sessionContextClient = new SessionContextClient(
			{ baseUrl: "" },
			createFoundationEnvironment({
				transport: createBaseTransportForStdFetch(),
			}),
		);

		const session = await sessionContextClient.refresh();
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
		const sessionContextClient = new SessionContextClient(
			{ baseUrl: "" },
			createFoundationEnvironment({
				transport: createBaseTransportForStdFetch(),
			}),
		);

		const session = await sessionContextClient.refresh();
		expect(session).toBeNull();
	});

	it("posts logout", async () => {
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
		const sessionContextClient = new SessionContextClient(
			{ baseUrl: "" },
			createFoundationEnvironment({
				transport: createBaseTransportForStdFetch(),
			}),
		);

		await sessionContextClient.logout();

		expect(fetchMock).toHaveBeenCalledTimes(1);
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

	it("maps credential-management CRUD envelopes into ClientError presentation for dashboard APIs", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							success: false,
							status: 409,
							error: {
								kind: "conflict",
								code: "duplicate_group_name",
								message: "A group with the same name already exists.",
								recovery: UserRecovery.None,
								presentation: {
									code: "duplicate_group_name",
									message: "A group with the same name already exists.",
									recovery: UserRecovery.None,
								},
							},
						}),
						{
							status: 409,
							statusText: "browser conflict text should not win",
							headers: { "content-type": "application/json" },
						},
					),
			),
		);

		const { api } = await import("../api/client");

		let failure: unknown;
		try {
			await api.post("/api/groups", { name: "Operators" });
		} catch (error) {
			failure = error;
		}

		expect(failure).toMatchObject({
			name: "ClientError",
			presentation: {
				code: "duplicate_group_name",
				message: "A group with the same name already exists.",
				recovery: UserRecovery.None,
			},
		});

		const descriptor = readErrorPresentationDescriptor(failure, {
			fallbackTitle: "Group action failed",
			fallbackDescription: "The group action could not complete.",
		});

		expect(descriptor.description).toBe(
			"A group with the same name already exists.",
		);
		expect(descriptor.recovery).toBe(UserRecovery.None);
		expect(descriptor.primaryAction).toBeNull();
	});
});
