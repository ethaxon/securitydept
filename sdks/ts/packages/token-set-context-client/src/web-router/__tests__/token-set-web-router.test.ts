import { describe, expect, it, vi } from "vitest";
import {
	EnsureAuthForResourceStatus,
	TokenSetAuthFlowSource,
} from "../../orchestration";
import { createTokenSetWebRouteAuthCandidate } from "../index";

describe("createTokenSetWebRouteAuthCandidate", () => {
	it("runs canonical token-set auth before raw web unauthenticated action", async () => {
		const ensureAuthForResource = vi.fn().mockResolvedValue({
			status: EnsureAuthForResourceStatus.Authenticated,
			snapshot: {
				tokens: { accessToken: "fresh-token" },
				metadata: {},
			},
			freshness: "fresh",
		});
		const onUnauthenticated = vi.fn(() => "/login");

		const candidate = createTokenSetWebRouteAuthCandidate({
			registry: { ensureAuthForResource },
			key: "confluence",
			requirementId: "confluence-oidc",
			requirementKind: "frontend_oidc",
			providerFamily: "authentik",
			url: () => new URL("https://app.example.com/wiki"),
			onUnauthenticated,
		});

		expect(candidate.checkAuthenticated()).toBe(false);
		await expect(candidate.onUnauthenticated()).resolves.toBe(true);
		expect(ensureAuthForResource).toHaveBeenCalledWith({
			key: "confluence",
			query: undefined,
			source: TokenSetAuthFlowSource.RawWebRouter,
			requirement: { id: "confluence-oidc", kind: "frontend_oidc" },
			providerFamily: "authentik",
			url: "https://app.example.com/wiki",
			forceRefreshWhenDue: true,
		});
		expect(onUnauthenticated).not.toHaveBeenCalled();
		expect(candidate.checkAuthenticated()).toBe(true);
	});
});
