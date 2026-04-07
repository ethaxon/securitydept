// Server helper — focused unit tests for basic-auth-context-client

import { describe, expect, it } from "vitest";
import { createBasicAuthServerHelper } from "../helpers";

describe("createBasicAuthServerHelper", () => {
	const helper = createBasicAuthServerHelper({
		config: {
			baseUrl: "https://auth.example.com",
			zones: [
				{ zonePrefix: "/api" },
				{ zonePrefix: "/admin", loginSubpath: "/signin" },
			],
		},
	});

	describe("handleUnauthorized", () => {
		it("returns redirect instruction for a path inside a zone", () => {
			const result = helper.handleUnauthorized({ path: "/api/data" });
			expect(result).not.toBeNull();
			expect(result?.statusCode).toBe(302);
			expect(result?.destination).toContain(
				"https://auth.example.com/api/login",
			);
			expect(result?.destination).toContain(
				"post_auth_redirect_uri=%2Fapi%2Fdata",
			);
		});

		it("returns null for a path outside all zones", () => {
			const result = helper.handleUnauthorized({ path: "/public/health" });
			expect(result).toBeNull();
		});

		it("matches the correct zone for nested paths", () => {
			const result = helper.handleUnauthorized({ path: "/admin/users" });
			expect(result).not.toBeNull();
			expect(result?.destination).toContain("/admin/signin");
		});
	});

	describe("loginUrlForPath", () => {
		it("returns login URL for a path inside a zone", () => {
			const url = helper.loginUrlForPath("/api/users");
			expect(url).not.toBeNull();
			expect(url).toContain("https://auth.example.com/api/login");
			expect(url).toContain("post_auth_redirect_uri=%2Fapi%2Fusers");
		});

		it("returns null for a path outside all zones", () => {
			const url = helper.loginUrlForPath("/public");
			expect(url).toBeNull();
		});
	});

	describe("logoutUrlForPath", () => {
		it("returns logout URL for a path inside a zone", () => {
			const url = helper.logoutUrlForPath("/api/users");
			expect(url).not.toBeNull();
			expect(url).toBe("https://auth.example.com/api/logout");
		});

		it("returns null for a path outside all zones", () => {
			const url = helper.logoutUrlForPath("/public");
			expect(url).toBeNull();
		});
	});

	describe("client access", () => {
		it("exposes the underlying BasicAuthContextClient", () => {
			expect(helper.client).toBeDefined();
			expect(helper.client.zones).toHaveLength(2);
		});
	});
});
