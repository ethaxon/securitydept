import { describe, expect, it } from "vitest";
import {
	parseIdentityPrincipal,
	parseIdentityPrincipalWire,
	projectIdentityPrincipal,
} from "../parsers";
import {
	IdentityPrincipalSchema,
	IdentityPrincipalWireSchema,
} from "../schemas";

describe("authenticated principal helpers", () => {
	it("parses camelCase principal payloads", () => {
		expect(
			parseIdentityPrincipal({
				subject: "user-1",
				displayName: "Alice",
				picture: "https://example.com/alice.png",
				issuer: "https://issuer.example.com",
				claims: { role: "admin" },
			}),
		).toEqual({
			subject: "user-1",
			displayName: "Alice",
			picture: "https://example.com/alice.png",
			issuer: "https://issuer.example.com",
			claims: { role: "admin" },
		});
	});

	it("parses snake_case wire payloads and falls back displayName to subject", () => {
		expect(
			parseIdentityPrincipalWire({
				subject: "user-2",
				display_name: "",
				claims: { tenant: "acme" },
			}),
		).toEqual({
			subject: "user-2",
			displayName: "user-2",
			picture: undefined,
			issuer: undefined,
			claims: { tenant: "acme" },
		});
	});

	it("rejects payloads without a stable subject", () => {
		expect(() => parseIdentityPrincipal({ displayName: "No Subject" })).toThrow(
			"Identity principal payload is invalid",
		);
		expect(() =>
			parseIdentityPrincipalWire({ display_name: "No Subject" }),
		).toThrow("Identity principal wire payload is invalid");
	});

	it("exposes standard schemas for nullable parser callers", () => {
		expect(
			IdentityPrincipalSchema["~standard"].validate({
				subject: "user-3",
				displayName: "",
			}),
		).toEqual({
			value: {
				subject: "user-3",
				displayName: "user-3",
				picture: undefined,
				issuer: undefined,
				claims: undefined,
			},
		});
		expect(
			IdentityPrincipalWireSchema["~standard"].validate({
				subject: "user-4",
				display_name: "Dana",
			}),
		).toEqual({
			value: {
				subject: "user-4",
				displayName: "Dana",
				picture: undefined,
				issuer: undefined,
				claims: undefined,
			},
		});
	});

	it("projects placeholder context principals when no authenticated principal is present", () => {
		expect(
			projectIdentityPrincipal({
				fallbackDisplayName: "Basic auth context",
				fallbackSubject: "context.basic-auth",
			}),
		).toEqual({
			subject: "context.basic-auth",
			displayName: "Basic auth context",
			picture: undefined,
			issuer: undefined,
			claims: undefined,
		});
	});
});
