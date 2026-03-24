import { describe, expect, it } from "vitest";
import { mergeTokenDelta, parseTokenFragment } from "../fragment-parser";

describe("parseTokenFragment", () => {
	it("should parse a full fragment", () => {
		const fragment =
			"access_token=abc123&refresh_token=rt456&id_token=idt789&expires_at=2026-01-01T00%3A00%3A00Z&metadata_redemption_id=mr001";

		const result = parseTokenFragment(fragment);

		expect(result.tokens.accessToken).toBe("abc123");
		expect(result.tokens.refreshMaterial).toBe("rt456");
		expect(result.tokens.idToken).toBe("idt789");
		expect(result.tokens.accessTokenExpiresAt).toBe("2026-01-01T00:00:00Z");
		expect(result.metadataRedemptionId).toBe("mr001");
	});

	it("should handle fragment with leading #", () => {
		const result = parseTokenFragment("#access_token=tok");
		expect(result.tokens.accessToken).toBe("tok");
	});

	it("should handle minimal fragment", () => {
		const result = parseTokenFragment("access_token=xyz");
		expect(result.tokens.accessToken).toBe("xyz");
		expect(result.tokens.refreshMaterial).toBeUndefined();
		expect(result.tokens.idToken).toBeUndefined();
		expect(result.metadataRedemptionId).toBeUndefined();
	});
});

describe("mergeTokenDelta", () => {
	it("should override access_token and preserve rest", () => {
		const snapshot = {
			accessToken: "old",
			idToken: "old_id",
			refreshMaterial: "old_rt",
			accessTokenExpiresAt: "2026-01-01T00:00:00Z",
		};

		const delta = {
			accessToken: "new",
		};

		const merged = mergeTokenDelta(snapshot, delta);

		expect(merged.accessToken).toBe("new");
		expect(merged.idToken).toBe("old_id");
		expect(merged.refreshMaterial).toBe("old_rt");
		expect(merged.accessTokenExpiresAt).toBe("2026-01-01T00:00:00Z");
	});

	it("should override all provided delta fields", () => {
		const snapshot = {
			accessToken: "old",
			idToken: "old_id",
			refreshMaterial: "old_rt",
		};

		const delta = {
			accessToken: "new",
			idToken: "new_id",
			refreshMaterial: "new_rt",
			accessTokenExpiresAt: "2026-06-01T00:00:00Z",
		};

		const merged = mergeTokenDelta(snapshot, delta);

		expect(merged.accessToken).toBe("new");
		expect(merged.idToken).toBe("new_id");
		expect(merged.refreshMaterial).toBe("new_rt");
		expect(merged.accessTokenExpiresAt).toBe("2026-06-01T00:00:00Z");
	});
});
