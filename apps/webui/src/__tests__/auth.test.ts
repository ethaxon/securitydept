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
	});

	it("consumes pending redirect when resolving login URL", async () => {
		const auth = await import("../api/auth");

		await auth.rememberPostAuthRedirect("/entries?tab=all");

		await expect(auth.resolveLoginUrl()).resolves.toBe(
			"/auth/session/login?post_auth_redirect_uri=%2Fentries%3Ftab%3Dall",
		);
		await expect(auth.resolveLoginUrl()).resolves.toBe("/auth/session/login");
	});

	it("stores and clears redirect intent via session helpers", async () => {
		const auth = await import("../api/auth");

		await auth.rememberPostAuthRedirect("/groups?tab=members");
		await expect(auth.resolveLoginUrl()).resolves.toBe(
			"/auth/session/login?post_auth_redirect_uri=%2Fgroups%3Ftab%3Dmembers",
		);

		// After consuming, the redirect intent is cleared
		await expect(auth.resolveLoginUrl()).resolves.toBe("/auth/session/login");
	});

	it("builds an explicit session login URL without consuming stored redirect intent", async () => {
		const auth = await import("../api/auth");

		await auth.rememberPostAuthRedirect("/groups?tab=members");
		expect(auth.buildLoginUrl("/playground/session")).toBe(
			"/auth/session/login?post_auth_redirect_uri=%2Fplayground%2Fsession",
		);
		await expect(auth.resolveLoginUrl()).resolves.toBe(
			"/auth/session/login?post_auth_redirect_uri=%2Fgroups%3Ftab%3Dmembers",
		);
	});

	it("fetchCurrentSession returns session when authenticated", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				createJsonResponse(200, {
					display_name: "Alice",
				}),
			),
		);
		const auth = await import("../api/auth");

		const session = await auth.fetchCurrentSession();
		expect(session).toEqual({
			principal: {
				displayName: "Alice",
				picture: undefined,
				claims: undefined,
			},
		});
	});

	it("fetchCurrentSession returns null when unauthenticated", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => createJsonResponse(401, { message: "unauthorized" })),
		);
		const auth = await import("../api/auth");

		const session = await auth.fetchCurrentSession();
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
		const auth = await import("../api/auth");

		await auth.rememberPostAuthRedirect("/entries/new");
		await auth.logoutCurrentSession();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		await expect(auth.resolveLoginUrl()).resolves.toBe("/auth/session/login");
	});
});
