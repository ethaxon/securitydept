import { describe, expect, it, vi } from "vitest";
import { createReplaySignal, createSignal } from "../../../signals";
import { createAuthorizationInterceptedFetch } from "../authorization-interceptor";

describe("createAuthorizationInterceptedFetch()", () => {
	it("injects authorization from a readable signal when predicate matches", async () => {
		const authorization = createSignal("Bearer access-token");
		const fetchSpy = createFetchSpy();
		const interceptedFetch = createAuthorizationInterceptedFetch(fetchSpy, {
			predicate: () => true,
			authorization,
		});

		await interceptedFetch("https://api.example.com/resource", {
			headers: { accept: "application/json" },
		});

		const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
		const headers = new Headers(init.headers);
		expect(headers.get("authorization")).toBe("Bearer access-token");
		expect(headers.get("accept")).toBe("application/json");
	});

	it("waits for authorization from a replay signal", async () => {
		const authorization = createReplaySignal<string>();
		const fetchSpy = createFetchSpy();
		const interceptedFetch = createAuthorizationInterceptedFetch(fetchSpy, {
			predicate: () => true,
			authorization,
		});

		const pending = interceptedFetch("https://api.example.com/resource");
		expect(fetchSpy).not.toHaveBeenCalled();
		authorization.setValue("Bearer replay-token");
		await pending;

		const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
		expect(new Headers(init.headers).get("authorization")).toBe(
			"Bearer replay-token",
		);
	});

	it("does not modify fetch arguments when predicate does not match", async () => {
		const authorization = createSignal("Bearer access-token");
		const fetchSpy = createFetchSpy();
		const init: RequestInit = { headers: { accept: "application/json" } };
		const interceptedFetch = createAuthorizationInterceptedFetch(fetchSpy, {
			predicate: () => false,
			authorization,
		});

		await interceptedFetch("https://api.example.com/public", init);

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://api.example.com/public",
			init,
		);
	});

	it("preserves caller authorization when resolved authorization is empty", async () => {
		const authorization = createSignal<string | undefined>(undefined);
		const fetchSpy = createFetchSpy();
		const init: RequestInit = {
			headers: { authorization: "Bearer caller-token" },
		};
		const interceptedFetch = createAuthorizationInterceptedFetch(fetchSpy, {
			predicate: () => true,
			authorization,
		});

		await interceptedFetch("https://api.example.com/resource", init);

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://api.example.com/resource",
			init,
		);
	});
});

function createFetchSpy(): typeof fetch & {
	mock: { calls: Parameters<typeof fetch>[] };
} {
	return vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
}
