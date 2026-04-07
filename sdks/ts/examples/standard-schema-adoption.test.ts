// @standard-schema validation baseline — adoption evidence
//
// This file demonstrates that the @standard-schema validation baseline
// is not just a foundation helper, but is actively used in real SDK
// public paths:
//   1. session-context-client: /me payload normalization
//   2. frontend-oidc-mode: config projection cross-boundary validation

import {
	createSchema,
	validateWithSchema,
	validateWithSchemaSync,
} from "@securitydept/client";
import {
	SessionInfoSchema,
	SessionUserInfoResponseSchema,
} from "@securitydept/session-context-client";
import {
	FrontendOidcModeConfigProjectionSchema,
	parseConfigProjection,
	validateConfigProjection,
} from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { describe, expect, it } from "vitest";

// ===========================================================================
// 1. Foundation validation — public-surface evidence
// ===========================================================================

describe("foundation @standard-schema validation", () => {
	it("createSchema produces a StandardSchemaV1-compatible schema usable with validateWithSchema", async () => {
		const schema = createSchema<{ id: number }>({
			validate(input: unknown) {
				if (
					typeof input === "object" &&
					input !== null &&
					"id" in input &&
					typeof (input as { id: unknown }).id === "number"
				) {
					return {
						value: { id: (input as { id: number }).id },
					};
				}
				return {
					issues: [{ message: "Expected { id: number }" }],
				};
			},
		});

		const success = await validateWithSchema(schema, { id: 42 });
		expect(success.success).toBe(true);
		if (success.success) {
			expect(success.value.id).toBe(42);
		}

		const failure = await validateWithSchema(schema, { id: "not-a-number" });
		expect(failure.success).toBe(false);
	});
});

// ===========================================================================
// 2. session-context-client adoption — /me payload normalization
// ===========================================================================

describe("session-context-client @standard-schema adoption", () => {
	it("SessionInfoSchema validates canonical camelCase payload", () => {
		const result = validateWithSchemaSync(SessionInfoSchema, {
			principal: {
				displayName: "Alice",
				picture: "https://cdn.example.com/alice.png",
				claims: { role: "admin" },
			},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.value.principal.displayName).toBe("Alice");
			expect(result.value.principal.picture).toBe(
				"https://cdn.example.com/alice.png",
			);
			expect(result.value.principal.claims).toEqual({ role: "admin" });
		}
	});

	it("SessionUserInfoResponseSchema validates server-side snake_case payload and normalizes", () => {
		const result = validateWithSchemaSync(SessionUserInfoResponseSchema, {
			display_name: "Bob",
			picture: "https://cdn.example.com/bob.png",
			claims: { team: "engineering" },
		});

		expect(result.success).toBe(true);
		if (result.success) {
			// Should normalize into SessionInfo shape.
			expect(result.value.principal.displayName).toBe("Bob");
			expect(result.value.principal.picture).toBe(
				"https://cdn.example.com/bob.png",
			);
		}
	});

	it("SessionInfoSchema rejects invalid payloads with structured issues", () => {
		const result = validateWithSchemaSync(SessionInfoSchema, {
			unexpected: true,
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues.length).toBeGreaterThan(0);
			expect(result.issues[0]?.message).toContain("displayName");
		}
	});
});

// ===========================================================================
// 3. frontend-oidc-mode adoption — config projection validation & parsing
// ===========================================================================

describe("frontend-oidc-mode @standard-schema adoption", () => {
	// --- Happy paths ---

	it("FrontendOidcModeConfigProjectionSchema validates a complete projection", () => {
		const result = validateWithSchemaSync(
			FrontendOidcModeConfigProjectionSchema,
			{
				clientId: "spa-client",
				redirectUrl: "https://app.example.com/callback",
				issuerUrl: "https://auth.example.com",
				scopes: ["openid", "profile"],
				pkceEnabled: true,
			},
		);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.value.clientId).toBe("spa-client");
			expect(result.value.redirectUrl).toBe("https://app.example.com/callback");
			expect(result.value.scopes).toEqual(["openid", "profile"]);
		}
	});

	it("validates projection with claims check script", () => {
		const result = validateConfigProjection({
			clientId: "spa-client",
			redirectUrl: "https://app.example.com/callback",
			claimsCheckScript: {
				type: "inline",
				content: "return true;",
			},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.value.claimsCheckScript).toEqual({
				type: "inline",
				content: "return true;",
			});
		}
	});

	// --- Required field failures ---

	it("rejects missing clientId", () => {
		const result = validateConfigProjection({
			redirectUrl: "https://app.example.com/callback",
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues[0]?.message).toContain("clientId");
		}
	});

	it("rejects missing redirectUrl", () => {
		const result = validateConfigProjection({
			clientId: "spa-client",
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues[0]?.message).toContain("redirectUrl");
		}
	});

	it("rejects non-object input", () => {
		const result = validateConfigProjection(null);
		expect(result.success).toBe(false);
	});

	// --- Structural validation failures (string array elements) ---

	it("rejects scopes array with non-string elements", () => {
		const result = validateConfigProjection({
			clientId: "spa-client",
			redirectUrl: "https://app.example.com/callback",
			scopes: [123, "profile"],
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues[0]?.message).toContain("scopes[0]");
			expect(result.issues[0]?.message).toContain("string");
		}
	});

	it("rejects requiredScopes array with non-string elements", () => {
		const result = validateConfigProjection({
			clientId: "spa-client",
			redirectUrl: "https://app.example.com/callback",
			requiredScopes: ["openid", true],
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues[0]?.message).toContain("requiredScopes[1]");
		}
	});

	// --- Structural validation failures (claimsCheckScript) ---

	it("rejects claimsCheckScript with wrong type field", () => {
		const result = validateConfigProjection({
			clientId: "spa-client",
			redirectUrl: "https://app.example.com/callback",
			claimsCheckScript: { type: "url", url: "https://example.com" },
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues[0]?.message).toContain("claimsCheckScript");
			expect(result.issues[0]?.message).toContain("inline");
		}
	});

	it("rejects claimsCheckScript that is a non-object value", () => {
		const result = validateConfigProjection({
			clientId: "spa-client",
			redirectUrl: "https://app.example.com/callback",
			claimsCheckScript: "not-an-object",
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues[0]?.message).toContain("claimsCheckScript");
		}
	});

	// --- Canonical public path: parseConfigProjection ---

	it("parseConfigProjection validates and converts to client config in one step", () => {
		const result = parseConfigProjection({
			clientId: "spa-client",
			redirectUrl: "https://app.example.com/callback",
			issuerUrl: "https://auth.example.com",
			scopes: ["openid", "profile"],
			pkceEnabled: true,
		});

		expect(result.success).toBe(true);
		if (result.success) {
			// The result.value is a FrontendOidcModeClientConfig, not a raw projection.
			expect(result.value.clientId).toBe("spa-client");
			expect(result.value.issuer).toBe("https://auth.example.com");
			expect(result.value.scopes).toEqual(["openid", "profile"]);
			expect(result.value.pkceEnabled).toBe(true);
		}
	});

	it("parseConfigProjection returns validation failure for invalid input", () => {
		const result = parseConfigProjection({
			clientId: "",
			redirectUrl: "https://app.example.com/callback",
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues[0]?.message).toContain("clientId");
		}
	});

	it("parseConfigProjection applies overrides to the resulting client config", () => {
		const result = parseConfigProjection(
			{
				clientId: "spa-client",
				redirectUrl: "https://app.example.com/callback",
				issuerUrl: "https://auth.example.com",
			},
			{ redirectUri: "https://custom.example.com/callback" },
		);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.value.redirectUri).toBe(
				"https://custom.example.com/callback",
			);
		}
	});
});
