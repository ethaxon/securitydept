import { describe, expect, it } from "vitest";
import {
	buildIssuerDiscoveryCandidates,
	resolveDiscoveryIssuerCompatibility,
} from "../discovery";

describe("frontend oidc discovery compatibility", () => {
	it("adds a trailing-slash issuer candidate for path-based issuers", () => {
		expect(
			buildIssuerDiscoveryCandidates(
				"https://auth.example.com/application/o/securitydept",
			),
		).toEqual([
			"https://auth.example.com/application/o/securitydept",
			"https://auth.example.com/application/o/securitydept/",
		]);
	});

	it("adds a no-trailing-slash issuer candidate when the configured issuer ends with a slash", () => {
		expect(
			buildIssuerDiscoveryCandidates(
				"https://auth.example.com/application/o/securitydept/",
			),
		).toEqual([
			"https://auth.example.com/application/o/securitydept/",
			"https://auth.example.com/application/o/securitydept",
		]);
	});

	it("does not add a slash-equivalent candidate for root issuers", () => {
		expect(buildIssuerDiscoveryCandidates("https://auth.example.com/")).toEqual(
			["https://auth.example.com/"],
		);
	});

	it("resolves a slash-compatible issuer directly from the discovery response", async () => {
		expect(
			await resolveDiscoveryIssuerCompatibility(
				new Response(
					JSON.stringify({
						issuer: "https://auth.example.com/application/o/securitydept/",
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				),
				"https://auth.example.com/application/o/securitydept",
			),
		).toBe("https://auth.example.com/application/o/securitydept/");
	});

	it("falls back to the configured issuer when the discovery body is unreadable", async () => {
		expect(
			await resolveDiscoveryIssuerCompatibility(
				new Response("not-json", {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
				"https://auth.example.com/application/o/securitydept",
			),
		).toBe("https://auth.example.com/application/o/securitydept");
	});
});
