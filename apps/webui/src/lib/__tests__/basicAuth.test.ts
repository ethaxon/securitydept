import { describe, expect, it } from "vitest";
import { buildBasicAuthLoginUrl } from "../basicAuth";

describe("basic auth playground helpers", () => {
	it("builds a basic login URL that returns to the current playground page", () => {
		expect(buildBasicAuthLoginUrl("/playground/basic-auth")).toBe(
			"/basic/login?post_auth_redirect_uri=%2Fplayground%2Fbasic-auth",
		);
	});
});
