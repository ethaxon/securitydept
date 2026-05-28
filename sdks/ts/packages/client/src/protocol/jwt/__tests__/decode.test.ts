import { describe, expect, it } from "vitest";
import { decodeJwtPayload } from "../decode";

function encodeBase64UrlJson(value: unknown): string {
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function jwt(payload: unknown): string {
	return `${encodeBase64UrlJson({ alg: "none" })}.${encodeBase64UrlJson(payload)}.`;
}

describe("decodeJwtPayload", () => {
	it("decodes compact JWT payload claims", () => {
		expect(
			decodeJwtPayload(
				jwt({
					iss: "https://issuer.example.com",
					sub: "subject-1",
					aud: ["client"],
					exp: 1_700_000_000,
				}),
			),
		).toMatchObject({
			iss: "https://issuer.example.com",
			sub: "subject-1",
			aud: ["client"],
			exp: 1_700_000_000,
		});
	});

	it("rejects non-object payloads", () => {
		expect(() => decodeJwtPayload(jwt("not-object"))).toThrow(
			/JWT payload must be a JSON object/,
		);
	});

	it("rejects invalid registered claim types", () => {
		expect(() => decodeJwtPayload(jwt({ exp: "soon" }))).toThrow(
			/JWT "exp" claim must be a number/,
		);
	});

	it("rejects non-compact JWS input", () => {
		expect(() => decodeJwtPayload("header.payload")).toThrow(
			/JWT must use compact JWS serialization/,
		);
	});
});
