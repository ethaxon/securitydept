import { createReplaySignal } from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import { createTokenSetWebRouteAuthCandidate } from "../index";

describe("createTokenSetWebRouteAuthCandidate", () => {
	it("waits for token-set auth truth before raw web unauthenticated action", async () => {
		const isAuthenticated = createReplaySignal<boolean>();
		isAuthenticated.setValue(true);
		const whenReady = vi.fn().mockResolvedValue({ isAuthenticated });
		const onUnauthenticated = vi.fn(() => "/login");

		const candidate = createTokenSetWebRouteAuthCandidate({
			registry: {
				whenReady,
				clientKeysForOptions: () => ["confluence"],
			},
			key: "confluence",
			requirementId: "confluence-oidc",
			requirementKind: "frontend_oidc",
			providerFamily: "authentik",
			url: () => new URL("https://app.example.com/wiki"),
			onUnauthenticated,
		});

		expect(candidate.checkAuthenticated()).toBe(false);
		await expect(candidate.onUnauthenticated()).resolves.toBe(true);
		expect(whenReady).toHaveBeenCalledWith("confluence");
		expect(onUnauthenticated).not.toHaveBeenCalled();
		expect(candidate.checkAuthenticated()).toBe(true);
	});
});
