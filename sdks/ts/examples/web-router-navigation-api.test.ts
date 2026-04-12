// @vitest-environment jsdom

// Web Router — Navigation API path evidence
//
// Iteration 110 evidence for @securitydept/client/web-router:
// proves the Navigation API adapter drives the router end-to-end when
// `window.navigation` is available, including pre-commit intercept,
// `redirect()`, and the planner-host integration.
//
// The jsdom environment does not ship `window.navigation`, so we install a
// minimal polyfill that mirrors the subset consumed by
// `createNavigationApiAdapter`. This is exactly what the router expects
// from a browser that implements the Navigation API spec.

import { createPlannerHost } from "@securitydept/client/auth-coordination";
import {
	createNavigationAdapter,
	createWebRouter,
	isNavigationApiAvailable,
	NavigationAdapterKind,
} from "@securitydept/client/web-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Minimal Navigation API polyfill (only the surface the adapter consumes)
// ---------------------------------------------------------------------------

interface PolyfilledNavigation {
	currentEntry: { getState(): unknown } | null;
	navigate(
		url: string,
		opts?: { history?: "push" | "replace"; state?: unknown; info?: unknown },
	): { committed: Promise<unknown>; finished: Promise<unknown> };
	back(): { committed: Promise<unknown> };
	forward(): { committed: Promise<unknown> };
	addEventListener(type: string, listener: (event: unknown) => void): void;
	removeEventListener(type: string, listener: (event: unknown) => void): void;
	__dispatch(type: string, event: unknown): void;
}

function installNavigationApiPolyfill(): PolyfilledNavigation {
	const listeners = new Map<string, Set<(event: unknown) => void>>();
	const dispatch = (type: string, event: unknown) => {
		for (const l of listeners.get(type) ?? new Set()) l(event);
	};

	const doNavigate = (
		url: string,
		opts?: { history?: "push" | "replace"; state?: unknown; info?: unknown },
	) => {
		let committedResolve: () => void = () => {};
		let finishedResolve: () => void = () => {};
		const committed = new Promise<void>((r) => {
			committedResolve = r;
		});
		const finished = new Promise<void>((r) => {
			finishedResolve = r;
		});
		const destinationUrl = new URL(url, location.href).toString();
		const event: {
			destination: { url: string; getState(): unknown };
			navigationType: "push" | "replace";
			canIntercept: boolean;
			userInitiated: boolean;
			intercept(options?: { handler?: () => Promise<void> | void }): void;
		} = {
			destination: {
				url: destinationUrl,
				getState: () => opts?.state ?? null,
			},
			navigationType: opts?.history === "replace" ? "replace" : "push",
			canIntercept: true,
			userInitiated: false,
			intercept({ handler } = {}) {
				const run = async () => {
					try {
						await handler?.();
						if (opts?.history === "replace") {
							history.replaceState(opts?.state ?? null, "", destinationUrl);
						} else {
							history.pushState(opts?.state ?? null, "", destinationUrl);
						}
						committedResolve();
						dispatch("navigatesuccess", {});
						finishedResolve();
					} catch (error) {
						// AbortError → navigation was cancelled or redirected.
						committedResolve();
						finishedResolve();
						// Re-throw for tests that want to inspect; swallow silently
						// otherwise to mimic the spec's "no unhandled rejection".
						void error;
					}
				};
				void run();
			},
		};
		// Fire the intercepted navigate event next tick so handlers can attach
		// before it runs (mirrors the browser's microtask timing).
		queueMicrotask(() => dispatch("navigate", event));
		return { committed, finished };
	};

	const nav: PolyfilledNavigation = {
		currentEntry: {
			getState() {
				return null;
			},
		},
		navigate: doNavigate,
		back() {
			// No-op for tests — we only exercise navigate() flows.
			return { committed: Promise.resolve() };
		},
		forward() {
			return { committed: Promise.resolve() };
		},
		addEventListener(type, listener) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)?.add(listener);
		},
		removeEventListener(type, listener) {
			listeners.get(type)?.delete(listener);
		},
		__dispatch: dispatch,
	};

	(globalThis as unknown as { navigation?: PolyfilledNavigation }).navigation =
		nav;
	return nav;
}

function uninstallNavigationApiPolyfill() {
	delete (globalThis as { navigation?: unknown }).navigation;
}

// ---------------------------------------------------------------------------
// Evidence tests
// ---------------------------------------------------------------------------

describe("Web Router — Navigation API adapter path", () => {
	beforeEach(() => {
		history.replaceState(null, "", "/");
		installNavigationApiPolyfill();
	});

	afterEach(() => {
		uninstallNavigationApiPolyfill();
	});

	it("isNavigationApiAvailable reports true when window.navigation is installed", () => {
		expect(isNavigationApiAvailable()).toBe(true);
	});

	it("auto-selects the Navigation API backend when available", () => {
		const router = createWebRouter({ routes: [] });
		expect(router.adapter.kind).toBe(NavigationAdapterKind.NavigationApi);
		router.destroy();
	});

	it("planner-host blocks unauthenticated navigation via redirect", async () => {
		const plannerHost = createPlannerHost();
		const onUnauthenticated = vi.fn().mockResolvedValue("/login");
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
				{ id: "login", match: "/login" },
			],
			navigationAdapter: { prefer: NavigationAdapterKind.NavigationApi },
		});

		await router.navigate("/profile");
		// Allow intercepted handler and subsequent redirect navigate to run.
		await new Promise((r) => queueMicrotask(() => r(undefined)));
		await new Promise((r) => queueMicrotask(() => r(undefined)));
		await new Promise((r) => queueMicrotask(() => r(undefined)));
		await new Promise((r) => queueMicrotask(() => r(undefined)));

		expect(onUnauthenticated).toHaveBeenCalled();
		expect(new URL(location.href).pathname).toBe("/login");
		router.destroy();
	});

	it("createNavigationAdapter honours prefer=navigation-api explicitly", () => {
		const adapter = createNavigationAdapter({
			prefer: NavigationAdapterKind.NavigationApi,
		});
		expect(adapter.kind).toBe(NavigationAdapterKind.NavigationApi);
		adapter.destroy();
	});

	it("commits a clean navigation when all requirements are authenticated", async () => {
		const plannerHost = createPlannerHost();
		const onNavigate = vi.fn();
		const router = createWebRouter({
			plannerHost,
			routes: [
				{
					id: "dashboard",
					match: "/dashboard",
					requirements: [
						{
							requirementId: "ok",
							requirementKind: "session",
							checkAuthenticated: () => true,
							onUnauthenticated: () => "/login",
						},
					],
				},
			],
			onNavigate,
		});

		await router.navigate("/dashboard");
		await new Promise((r) => queueMicrotask(() => r(undefined)));
		await new Promise((r) => queueMicrotask(() => r(undefined)));
		await new Promise((r) => queueMicrotask(() => r(undefined)));

		expect(new URL(location.href).pathname).toBe("/dashboard");
		expect(onNavigate).toHaveBeenCalled();
		router.destroy();
	});
});
