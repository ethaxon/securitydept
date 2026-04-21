import { describe, expect, it } from "vitest";
import {
	normalizeAuthenticatedPrincipal,
	normalizeAuthenticatedPrincipalWire,
	projectAuthenticatedPrincipal,
} from "../principal";

describe("authenticated principal helpers", () => {
	it("normalizes camelCase principal payloads", () => {
		expect(
			normalizeAuthenticatedPrincipal({
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

	it("normalizes snake_case wire payloads and falls back displayName to subject", () => {
		expect(
			normalizeAuthenticatedPrincipalWire({
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
		expect(
			normalizeAuthenticatedPrincipal({ displayName: "No Subject" }),
		).toBeNull();
		expect(
			normalizeAuthenticatedPrincipalWire({ display_name: "No Subject" }),
		).toBeNull();
	});

	it("projects placeholder context principals when no authenticated principal is present", () => {
		expect(
			projectAuthenticatedPrincipal({
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
