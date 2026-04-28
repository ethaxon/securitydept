import { describe, expect, it } from "vitest";
import { createTokenHandleStore, TokenHandleKind } from "../token-handle-store";

describe("createTokenHandleStore", () => {
	it("issues opaque handles without exposing token values", () => {
		const store = createTokenHandleStore({ now: () => 1_000 });
		const handle = store.issue({
			kind: TokenHandleKind.AccessToken,
			token: "secret-access-token",
			clientKey: "confluence",
			ttlMs: 5_000,
		});

		expect(JSON.stringify(handle)).not.toContain("secret-access-token");
		expect(store.get(handle)).toBe("secret-access-token");
	});

	it("revokes and consumes handles", () => {
		const store = createTokenHandleStore({ now: () => 1_000 });
		const consumed = store.issue({
			kind: TokenHandleKind.AccessToken,
			token: "consume-me",
		});
		const revoked = store.issue({
			kind: TokenHandleKind.AccessToken,
			token: "revoke-me",
		});

		expect(store.consume(consumed)).toBe("consume-me");
		expect(store.get(consumed)).toBeNull();

		store.revoke(revoked);
		expect(store.get(revoked)).toBeNull();
	});

	it("expires handles and clears by client", () => {
		let now = 1_000;
		const store = createTokenHandleStore({ now: () => now });
		const expiring = store.issue({
			kind: TokenHandleKind.AccessToken,
			token: "short",
			ttlMs: 10,
		});
		const clientScoped = store.issue({
			kind: TokenHandleKind.AccessToken,
			token: "client-token",
			clientKey: "confluence",
		});

		now = 1_011;
		expect(store.get(expiring)).toBeNull();

		store.clearByClient("confluence");
		expect(store.get(clientScoped)).toBeNull();
	});
});
