import { describe, expect, it } from "vitest";
import {
	callbackReturnsToTokenSnapshot,
	parseBackendOidcModeCallbackFragment,
	parseBackendOidcModeRefreshFragment,
	refreshReturnsToTokenDelta,
} from "../parsers";

describe("parseBackendOidcModeCallbackFragment", () => {
	it("should parse a full callback fragment", () => {
		const fragment =
			"access_token=abc123&refresh_token=rt456&id_token=idt789&expires_at=2026-01-01T00%3A00%3A00Z&metadata_redemption_id=mr001";

		const result = parseBackendOidcModeCallbackFragment(fragment);

		expect(result).not.toBeNull();
		expect(result!.accessToken).toBe("abc123");
		expect(result!.idToken).toBe("idt789");
		expect(result!.refreshToken).toBe("rt456");
		expect(result!.expiresAt).toBe("2026-01-01T00:00:00Z");
		expect(result!.metadataRedemptionId).toBe("mr001");
	});

	it("should handle fragment with leading #", () => {
		const result = parseBackendOidcModeCallbackFragment(
			"#access_token=tok&id_token=idt",
		);
		expect(result?.accessToken).toBe("tok");
		expect(result?.idToken).toBe("idt");
	});

	it("should return null when access_token is missing", () => {
		const result = parseBackendOidcModeCallbackFragment("id_token=idt");
		expect(result).toBeNull();
	});

	it("should return null when id_token is missing", () => {
		const result = parseBackendOidcModeCallbackFragment("access_token=tok");
		expect(result).toBeNull();
	});

	it("should handle fragment without optional fields", () => {
		const result = parseBackendOidcModeCallbackFragment(
			"access_token=tok&id_token=idt",
		);
		expect(result?.accessToken).toBe("tok");
		expect(result?.refreshToken).toBeUndefined();
		expect(result?.expiresAt).toBeUndefined();
		expect(result?.metadataRedemptionId).toBeUndefined();
	});
});

describe("parseBackendOidcModeRefreshFragment", () => {
	it("should parse a full refresh fragment", () => {
		const fragment =
			"access_token=at2&refresh_token=rt2&id_token=idt2&expires_at=2026-02-01T00%3A00%3A00Z&metadata_redemption_id=mr002";

		const result = parseBackendOidcModeRefreshFragment(fragment);

		expect(result).not.toBeNull();
		expect(result!.accessToken).toBe("at2");
		expect(result!.idToken).toBe("idt2");
		expect(result!.refreshToken).toBe("rt2");
		expect(result!.expiresAt).toBe("2026-02-01T00:00:00Z");
		expect(result!.metadataRedemptionId).toBe("mr002");
	});

	it("should return null when access_token is missing", () => {
		const result = parseBackendOidcModeRefreshFragment("refresh_token=rt");
		expect(result).toBeNull();
	});

	it("should handle refresh without optional fields", () => {
		const result = parseBackendOidcModeRefreshFragment("access_token=at");
		expect(result?.accessToken).toBe("at");
		expect(result?.idToken).toBeUndefined();
		expect(result?.metadataRedemptionId).toBeUndefined();
	});
});

describe("callbackFragmentToTokenSnapshot", () => {
	it("maps fragment fields to orchestration TokenSnapshot", () => {
		const snapshot = callbackReturnsToTokenSnapshot({
			accessToken: "at",
			idToken: "idt",
			refreshToken: "rt",
			expiresAt: "2026-01-01T00:00:00Z",
		});

		expect(snapshot.accessToken).toBe("at");
		expect(snapshot.idToken).toBe("idt");
		expect(snapshot.refreshMaterial).toBe("rt");
		expect(snapshot.accessTokenExpiresAt).toBe("2026-01-01T00:00:00Z");
	});
});

describe("refreshFragmentToTokenDelta", () => {
	it("maps fragment fields to orchestration TokenDelta", () => {
		const delta = refreshReturnsToTokenDelta({
			accessToken: "at2",
			idToken: "idt2",
			refreshToken: "rt2",
			expiresAt: "2026-02-01T00:00:00Z",
		});

		expect(delta.accessToken).toBe("at2");
		expect(delta.idToken).toBe("idt2");
		expect(delta.refreshMaterial).toBe("rt2");
		expect(delta.accessTokenExpiresAt).toBe("2026-02-01T00:00:00Z");
	});

	it("handles optional fields as undefined", () => {
		const delta = refreshReturnsToTokenDelta({ accessToken: "at" });
		expect(delta.accessToken).toBe("at");
		expect(delta.idToken).toBeUndefined();
		expect(delta.refreshMaterial).toBeUndefined();
	});
});
