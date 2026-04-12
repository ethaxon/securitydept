// @vitest-environment jsdom

// Web Router — History API fallback path evidence
//
// Iteration 110 evidence: when `window.navigation` is absent the router
// must fall back to the classic History API + popstate + anchor-click
// capture. Same external contract, different wire.
//
// This test deliberately does not install the Navigation API polyfill so
// the jsdom default (history-only) state is exercised.

import { createPlannerHost } from "@securitydept/client/auth-coordination";
import {
	createHistoryAdapter,
	createNavigationAdapter,
	createWebRouter,
	isNavigationApiAvailable,
	NavigationAdapterKind,
} from "@securitydept/client/web-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Web Router — History API fallback path", () => {
	beforeEach(() => {
		history.replaceState(null, "", "/");
		// Ensure we are genuinely in fallback mode.
		delete (globalThis as { navigation?: unknown }).navigation;
	});

	afterEach(() => {
		delete (globalThis as { navigation?: unknown }).navigation;
	});

	it("isNavigationApiAvailable reports false without window.navigation", () => {
		expect(isNavigationApiAvailable()).toBe(false);
	});

	it("auto-selects the History adapter when Navigation API is missing", () => {
		const router = createWebRouter({});
		expect(router.adapter.kind).toBe(NavigationAdapterKind.History);
		router.destroy();
	});

	it("history navigate commits via history.pushState + commit listeners", async () => {
		const router = createWebRouter({});
		const commits: string[] = [];
		router.onNavigate((c) => commits.push(c.url.pathname));

		await router.navigate("/a");
		await router.navigate("/b");
		await router.navigate("/c", { replace: true });

		expect(commits).toEqual(["/a", "/b", "/c"]);
		expect(location.pathname).toBe("/c");
		router.destroy();
	});

	it("planner-host blocks unauthenticated navigation via cancel (preventDefault)", async () => {
		const plannerHost = createPlannerHost();
		const onUnauthenticated = vi.fn().mockResolvedValue(false);
		const router = createWebRouter({
			plannerHost,
			routes: [
				{
					id: "profile",
					match: "/profile",
					requirements: [
						{
							requirementId: "session",
							requirementKind: "session",
							checkAuthenticated: () => false,
							onUnauthenticated,
						},
					],
				},
			],
		});

		const startPath = location.pathname;
		await router.navigate("/profile");
		expect(onUnauthenticated).toHaveBeenCalled();
		// Cancelled navigation — URL remains at the starting path.
		expect(location.pathname).toBe(startPath);
		router.destroy();
	});

	it("planner-host redirects unauthenticated navigation when a URL is returned", async () => {
		const plannerHost = createPlannerHost();
		const router = createWebRouter({
			plannerHost,
			routes: [
				{
					id: "profile",
					match: "/profile",
					requirements: [
						{
							requirementId: "session",
							requirementKind: "session",
							checkAuthenticated: () => false,
							onUnauthenticated: async () => "/login",
						},
					],
				},
				{ id: "login", match: "/login" },
			],
		});

		await router.navigate("/profile");
		expect(location.pathname).toBe("/login");
		router.destroy();
	});

	it("createNavigationAdapter honours prefer=history even when Navigation API exists", () => {
		// Force Navigation API availability via a minimal stub, but ask the
		// factory to pick history anyway.
		(globalThis as { navigation?: unknown }).navigation = {
			addEventListener: () => {},
			removeEventListener: () => {},
			navigate: () => ({ committed: Promise.resolve() }),
			back: () => ({ committed: Promise.resolve() }),
			forward: () => ({ committed: Promise.resolve() }),
			currentEntry: { getState: () => null },
		};
		const adapter = createNavigationAdapter({
			prefer: NavigationAdapterKind.History,
		});
		expect(adapter.kind).toBe(NavigationAdapterKind.History);
		adapter.destroy();
	});

	it("bare createHistoryAdapter is publicly accessible for adopters who want it explicitly", async () => {
		const adapter = createHistoryAdapter({ captureAnchorClicks: false });
		expect(adapter.kind).toBe(NavigationAdapterKind.History);
		const seen: URL[] = [];
		adapter.onNavigate((c) => seen.push(c.url));
		await adapter.navigate("/x");
		expect(seen).toHaveLength(1);
		expect(seen[0].pathname).toBe("/x");
		adapter.destroy();
	});
});
