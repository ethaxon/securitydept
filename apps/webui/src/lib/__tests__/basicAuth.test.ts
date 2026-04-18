import { describe, expect, it } from "vitest";
import {
	BasicAuthBoundaryKind,
	buildBasicAuthLoginUrl,
	readBasicAuthBoundaryKind,
} from "../basicAuth";

describe("basic auth playground helpers", () => {
	it("builds a basic login URL that returns to the current playground page", () => {
		expect(buildBasicAuthLoginUrl("/playground/basic-auth")).toBe(
			"/basic/login?post_auth_redirect_uri=%2Fplayground%2Fbasic-auth",
		);
	});

	it("treats a 401 with WWW-Authenticate as an explicit challenge path", () => {
		expect(
			readBasicAuthBoundaryKind({
				status: 401,
				challengeHeader: 'Basic realm="securitydept"',
				requestPath: "/basic/login",
			}),
		).toBe(BasicAuthBoundaryKind.Challenge);
	});

	it("treats a 401 logout response without WWW-Authenticate as poison", () => {
		expect(
			readBasicAuthBoundaryKind({
				status: 401,
				challengeHeader: null,
				requestPath: "/basic/logout",
			}),
		).toBe(BasicAuthBoundaryKind.LogoutPoison);
	});

	it("treats a protected JSON 401 without WWW-Authenticate as plain unauthorized", () => {
		expect(
			readBasicAuthBoundaryKind({
				status: 401,
				challengeHeader: null,
				requestPath: "/basic/api/entries",
			}),
		).toBe(BasicAuthBoundaryKind.Unauthorized);
	});
});
