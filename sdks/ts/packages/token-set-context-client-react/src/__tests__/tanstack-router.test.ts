import {
	EnsureAuthForResourceStatus,
	TokenSetAuthFlowSource,
} from "@securitydept/token-set-context-client/orchestration";
import { describe, expect, it, vi } from "vitest";
import { createTokenSetSecureBeforeLoad } from "../tanstack-router";

function createBeforeLoadContext() {
	return {
		location: { pathname: "/wiki", href: "https://app.example.com/wiki" },
		cause: "enter",
		matches: [
			{
				routeId: "__root__",
				staticData: {},
			},
			{
				routeId: "/wiki",
				staticData: {
					authRequirements: [
						{
							id: "confluence-oidc",
							kind: "frontend_oidc",
							attributes: {
								clientKey: "confluence",
								providerFamily: "authentik",
							},
						},
					],
				},
			},
		],
	};
}

describe("createTokenSetSecureBeforeLoad", () => {
	it("waits for token-set refresh before invoking unauthenticated redirect", async () => {
		const ensureAuthForResource = vi.fn().mockResolvedValue({
			status: EnsureAuthForResourceStatus.Authenticated,
			snapshot: {
				tokens: { accessToken: "fresh-token" },
				metadata: {},
			},
			freshness: "fresh",
		});
		const defaultOnUnauthenticated = vi.fn(() => "/login");
		const redirect = vi.fn((opts: { to: string }) => {
			throw new Error(`redirected to ${opts.to}`);
		});

		const beforeLoad = createTokenSetSecureBeforeLoad({
			registry: { ensureAuthForResource },
			redirect,
			defaultOnUnauthenticated,
		});

		await expect(
			beforeLoad(createBeforeLoadContext()),
		).resolves.toBeUndefined();
		expect(ensureAuthForResource).toHaveBeenCalledWith({
			key: "confluence",
			query: {
				requirementKind: "frontend_oidc",
				providerFamily: "authentik",
			},
			source: TokenSetAuthFlowSource.TanStackBeforeLoad,
			requirement: { id: "confluence-oidc", kind: "frontend_oidc" },
			providerFamily: "authentik",
			url: "https://app.example.com/wiki",
			forceRefreshWhenDue: true,
		});
		expect(defaultOnUnauthenticated).not.toHaveBeenCalled();
		expect(redirect).not.toHaveBeenCalled();
	});
});
