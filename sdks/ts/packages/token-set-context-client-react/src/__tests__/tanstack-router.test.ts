import { createReplaySignal } from "@securitydept/client";
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
	it("waits for token-set auth truth before invoking unauthenticated redirect", async () => {
		const isAuthenticated = createReplaySignal<boolean>();
		isAuthenticated.emit(true);
		const whenReady = vi.fn().mockResolvedValue({ isAuthenticated });
		const defaultOnUnauthenticated = vi.fn(() => "/login");
		const redirect = vi.fn((opts: { to: string }) => {
			throw new Error(`redirected to ${opts.to}`);
		});

		const beforeLoad = createTokenSetSecureBeforeLoad({
			registry: {
				whenReady,
				clientKeysForOptions: () => ["confluence"],
			},
			redirect,
			defaultOnUnauthenticated,
		});

		await expect(
			beforeLoad(createBeforeLoadContext()),
		).resolves.toBeUndefined();
		expect(whenReady).toHaveBeenCalledWith("confluence");
		expect(defaultOnUnauthenticated).not.toHaveBeenCalled();
		expect(redirect).not.toHaveBeenCalled();
	});
});
