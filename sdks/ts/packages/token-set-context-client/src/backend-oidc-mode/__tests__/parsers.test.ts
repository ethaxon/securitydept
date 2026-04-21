import { describe, expect, it } from "vitest";
import { parseBackendOidcModeUserInfoBody } from "../parsers";

describe("parseBackendOidcModeUserInfoBody", () => {
	it("normalizes the shared authenticated principal contract from snake_case wire fields", () => {
		expect(
			parseBackendOidcModeUserInfoBody({
				subject: "user-1",
				display_name: "",
				issuer: "https://issuer.example.com",
				claims: { team: "platform" },
			}),
		).toEqual({
			subject: "user-1",
			displayName: "user-1",
			picture: undefined,
			issuer: "https://issuer.example.com",
			claims: { team: "platform" },
		});
	});

	it("rejects user-info payloads without a stable subject", () => {
		expect(
			parseBackendOidcModeUserInfoBody({
				display_name: "Alice",
			}),
		).toBeNull();
	});
});
