import { ClientError } from "@securitydept/client";
import { describe, expect, it } from "vitest";
import { createBasicAuthorizationHeaderValue } from "../authorization-header";

describe("createBasicAuthorizationHeaderValue", () => {
	it("encodes UTF-8 credentials as a Basic authorization header value", () => {
		expect(
			createBasicAuthorizationHeaderValue({
				username: "user",
				password: "pässword",
			}),
		).toBe("Basic dXNlcjpww6Rzc3dvcmQ=");
	});

	it("rejects usernames containing the Basic credential delimiter", () => {
		expect(() =>
			createBasicAuthorizationHeaderValue({
				username: "user:name",
				password: "password",
			}),
		).toThrow(ClientError);
	});
});
