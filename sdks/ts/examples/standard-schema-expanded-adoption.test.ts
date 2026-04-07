// Focused behavioral evidence for @standard-schema adoption in
// basic-auth-context-client and backend-oidc-mode body parsers.
//
// Tests validate both success and failure paths with real invalid payloads.

import {
	BasicAuthContextClient,
	BasicAuthContextClientConfigSchema,
} from "@securitydept/basic-auth-context-client";
import { validateWithSchemaSync } from "@securitydept/client";
import {
	parseBackendOidcModeCallbackBody,
	parseBackendOidcModeRefreshBody,
} from "@securitydept/token-set-context-client/backend-oidc-mode";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Task A: BasicAuthContextClientConfig schema adoption
// ---------------------------------------------------------------------------

describe("@standard-schema adoption: BasicAuthContextClientConfig", () => {
	it("accepts a valid config", () => {
		const result = validateWithSchemaSync(BasicAuthContextClientConfigSchema, {
			baseUrl: "https://auth.example.com",
			zones: [{ zonePrefix: "/admin" }],
		});
		expect(result.success).toBe(true);
	});

	it("rejects config with missing baseUrl", () => {
		const result = validateWithSchemaSync(BasicAuthContextClientConfigSchema, {
			zones: [{ zonePrefix: "/admin" }],
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues.some((i) => i.message.includes("baseUrl"))).toBe(
				true,
			);
		}
	});

	it("rejects config with empty zones array", () => {
		const result = validateWithSchemaSync(BasicAuthContextClientConfigSchema, {
			baseUrl: "https://auth.example.com",
			zones: [],
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues.some((i) => i.message.includes("zones"))).toBe(true);
		}
	});

	it("rejects config with invalid zone (missing zonePrefix)", () => {
		const result = validateWithSchemaSync(BasicAuthContextClientConfigSchema, {
			baseUrl: "https://auth.example.com",
			zones: [{}],
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues.some((i) => i.message.includes("zonePrefix"))).toBe(
				true,
			);
		}
	});

	it("rejects non-object input", () => {
		const result = validateWithSchemaSync(
			BasicAuthContextClientConfigSchema,
			"not-an-object",
		);
		expect(result.success).toBe(false);
	});

	it("constructor warns on invalid config (deprecation-first)", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		// Intentionally passing invalid config — should warn, not throw.
		const client = new BasicAuthContextClient(
			{} as unknown as Parameters<
				typeof BasicAuthContextClient extends new (
					config: infer C,
				) => unknown
					? (config: C) => void
					: never
			>[0],
		);
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("Deprecated config shape detected"),
		);
		// Client should still construct, just with empty zones.
		expect(client.zones).toEqual([]);
		warnSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// Task B: BackendOidcMode callback/refresh body schema adoption
// ---------------------------------------------------------------------------

describe("@standard-schema adoption: BackendOidcMode body parsers", () => {
	describe("parseBackendOidcModeCallbackBody", () => {
		it("parses a valid callback body", () => {
			const result = parseBackendOidcModeCallbackBody({
				access_token: "at-123",
				id_token: "id-456",
				refresh_token: "rt-789",
				access_token_expires_at: "2026-01-01T00:00:00Z",
				metadata_redemption_id: "meta-abc",
			});
			expect(result).toEqual({
				accessToken: "at-123",
				idToken: "id-456",
				refreshToken: "rt-789",
				expiresAt: "2026-01-01T00:00:00Z",
				metadataRedemptionId: "meta-abc",
			});
		});

		it("parses a minimal callback body (required fields only)", () => {
			const result = parseBackendOidcModeCallbackBody({
				access_token: "at-123",
				id_token: "id-456",
			});
			expect(result).not.toBeNull();
			if (result) {
				expect(result.accessToken).toBe("at-123");
				expect(result.idToken).toBe("id-456");
			}
		});

		it("returns null when access_token is missing", () => {
			const result = parseBackendOidcModeCallbackBody({
				id_token: "id-456",
			});
			expect(result).toBeNull();
		});

		it("returns null when id_token is missing", () => {
			const result = parseBackendOidcModeCallbackBody({
				access_token: "at-123",
			});
			expect(result).toBeNull();
		});

		it("returns null for non-string access_token", () => {
			const result = parseBackendOidcModeCallbackBody({
				access_token: 123,
				id_token: "id-456",
			});
			expect(result).toBeNull();
		});

		it("returns null when optional refresh_token has wrong type", () => {
			const result = parseBackendOidcModeCallbackBody({
				access_token: "at-123",
				id_token: "id-456",
				refresh_token: 123,
			});
			expect(result).toBeNull();
		});

		it("returns null when optional access_token_expires_at has wrong type", () => {
			const result = parseBackendOidcModeCallbackBody({
				access_token: "at-123",
				id_token: "id-456",
				access_token_expires_at: false,
			});
			expect(result).toBeNull();
		});
	});

	describe("parseBackendOidcModeRefreshBody", () => {
		it("parses a valid refresh body", () => {
			const result = parseBackendOidcModeRefreshBody({
				access_token: "at-new",
				id_token: "id-new",
				refresh_token: "rt-new",
			});
			expect(result).toEqual({
				accessToken: "at-new",
				idToken: "id-new",
				refreshToken: "rt-new",
				expiresAt: undefined,
				metadataRedemptionId: undefined,
			});
		});

		it("parses a minimal refresh body", () => {
			const result = parseBackendOidcModeRefreshBody({
				access_token: "at-only",
			});
			expect(result).not.toBeNull();
			if (result) {
				expect(result.accessToken).toBe("at-only");
			}
		});

		it("returns null when access_token is missing", () => {
			const result = parseBackendOidcModeRefreshBody({
				id_token: "id-only",
			});
			expect(result).toBeNull();
		});

		it("returns null when optional refresh_token has wrong type", () => {
			const result = parseBackendOidcModeRefreshBody({
				access_token: "at-123",
				refresh_token: { nested: true },
			});
			expect(result).toBeNull();
		});
	});
});
