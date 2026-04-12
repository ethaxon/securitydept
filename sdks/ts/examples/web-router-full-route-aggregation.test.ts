// @vitest-environment jsdom

// Web Router full-route aggregation evidence — iteration 110 review-1 fix
//
// Proves that `@securitydept/client/web-router` now ships the same contract
// depth the Angular / TanStack adapters already offer:
//
// 1. Parent + child requirement segments are aggregated into a single
//    candidate set (`extractFullRouteRequirements`).
// 2. `merge` composition preserves parent requirements and appends / replaces
//    by `requirementId`.
// 3. `replace` composition discards parent requirements — parent-protected
//    trees can carve out public leaves without leaking parent requirements.
// 4. `inherit` composition keeps parent requirements unchanged even when the
//    child declares nothing.
// 5. A single `plannerHost.evaluate()` call is issued per navigation,
//    regardless of chain depth. The router never evaluates parent and child
//    requirements separately.
// 6. Route chain is exposed on the match so adopters can extract it for
//    logging / telemetry.
//
// Previously the router only evaluated `match.route.requirements` — so
// Finding 2 of the iteration 110 review-1 document applied.

import {
	createPlannerHost,
	RequirementsClientSetComposition as SharedComposition,
} from "@securitydept/client/auth-coordination";
import {
	createWebRouter,
	defineWebRoute,
	extractFullRouteRequirements,
	NavigationAdapterKind,
	RequirementsClientSetComposition,
	type WebRouteDefinition,
} from "@securitydept/client/web-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidate(
	id: string,
	kind: string,
	checkAuthenticated: () => boolean,
	onUnauthenticated: () => boolean | string | Promise<boolean | string> = () =>
		false,
) {
	return {
		requirementId: id,
		requirementKind: kind,
		checkAuthenticated,
		onUnauthenticated,
	};
}

describe("web-router — full-route requirement aggregation", () => {
	beforeEach(() => {
		history.replaceState(null, "", "/");
		delete (globalThis as { navigation?: unknown }).navigation;
	});
	afterEach(() => {
		history.replaceState(null, "", "/");
	});

	it("re-exports RequirementsClientSetComposition so the web-router subpath is self-contained", () => {
		expect(RequirementsClientSetComposition).toBe(SharedComposition);
	});

	it("extracts parent + child requirements with the default merge composition", () => {
		const chain: WebRouteDefinition[] = [
			defineWebRoute({
				id: "root",
				requirements: [makeCandidate("session", "session", () => true)],
				children: [
					defineWebRoute({
						id: "dashboard",
						match: "/dashboard",
						requirements: [makeCandidate("oidc", "frontend_oidc", () => true)],
					}),
				],
			}),
		];

		const leaf = chain[0].children?.[0];
		if (!leaf) throw new Error("unexpected leaf shape");

		const aggregated = extractFullRouteRequirements([chain[0], leaf]);
		expect(aggregated.map((c) => c.requirementId)).toEqual(["session", "oidc"]);
	});

	it("child replace composition discards parent requirements", () => {
		const parent = defineWebRoute({
			id: "root",
			requirements: [makeCandidate("session", "session", () => false)],
		});
		const leaf = defineWebRoute({
			id: "public-zone",
			match: "/public",
			composition: RequirementsClientSetComposition.Replace,
			requirements: [],
		});

		const aggregated = extractFullRouteRequirements([parent, leaf]);
		expect(aggregated).toEqual([]);
	});

	it("child inherit composition keeps parent requirements untouched", () => {
		const parent = defineWebRoute({
			id: "root",
			requirements: [makeCandidate("session", "session", () => false)],
		});
		const leaf = defineWebRoute({
			id: "settings",
			match: "/settings",
			composition: RequirementsClientSetComposition.Inherit,
		});

		const aggregated = extractFullRouteRequirements([parent, leaf]);
		expect(aggregated.map((c) => c.requirementId)).toEqual(["session"]);
	});

	it("child merge overrides parent candidate with the same requirementId", async () => {
		const parent = defineWebRoute({
			id: "root",
			requirements: [
				makeCandidate(
					"gate",
					"session",
					() => false,
					() => "/parent-login",
				),
			],
		});
		const leaf = defineWebRoute({
			id: "admin",
			match: "/admin",
			requirements: [
				makeCandidate(
					"gate",
					"session",
					() => false,
					() => "/admin-login",
				),
			],
		});

		const aggregated = extractFullRouteRequirements([parent, leaf]);
		expect(aggregated).toHaveLength(1);
		const chosen = aggregated[0];
		expect(chosen.requirementId).toBe("gate");
		// Child's `onUnauthenticated` supersedes the parent's (merge
		// override by requirementId).
		expect(await Promise.resolve(chosen.onUnauthenticated())).toBe(
			"/admin-login",
		);
	});

	it("router matches a nested leaf and exposes the full root→leaf chain", async () => {
		const protectedLeaf = defineWebRoute({
			id: "finance",
			match: "/finance",
			requirements: [makeCandidate("finance", "frontend_oidc", () => true)],
		});
		const parent = defineWebRoute({
			id: "app",
			requirements: [makeCandidate("session", "session", () => true)],
			children: [protectedLeaf],
		});

		const router = createWebRouter({
			routes: [parent],
			navigationAdapter: { prefer: NavigationAdapterKind.History },
		});

		const match = router.match(new URL("http://localhost/finance"));
		expect(match).not.toBeNull();
		expect(match?.route.id).toBe("finance");
		expect(match?.chain.map((r) => r.id)).toEqual(["app", "finance"]);

		// Router-level aggregation yields both parent and child requirements.
		const aggregated = router.extractRequirements(match!);
		expect(aggregated.map((c) => c.requirementId)).toEqual([
			"session",
			"finance",
		]);

		router.destroy();
	});

	it("planner-host sees the aggregated set in a single evaluate() call and blocks navigation when a nested requirement fails", async () => {
		const evaluate = vi.fn(createPlannerHost().evaluate);
		const plannerHost = { evaluate };

		const onChildUnauth = vi.fn().mockResolvedValue("/login/child");

		const router = createWebRouter({
			plannerHost,
			navigationAdapter: { prefer: NavigationAdapterKind.History },
			routes: [
				defineWebRoute({
					id: "app",
					requirements: [makeCandidate("session", "session", () => true)],
					children: [
						defineWebRoute({
							id: "child",
							match: "/child",
							requirements: [
								makeCandidate(
									"child-oidc",
									"frontend_oidc",
									() => false,
									onChildUnauth,
								),
							],
						}),
					],
				}),
			],
		});

		await router.navigate("/child");
		// Allow async unauthenticated handler to resolve.
		await new Promise((r) => queueMicrotask(() => r(undefined)));
		await new Promise((r) => queueMicrotask(() => r(undefined)));

		expect(evaluate).toHaveBeenCalledTimes(1);
		// The evaluate() call received the full aggregated set (2 candidates,
		// not just the leaf requirement).
		const candidates = evaluate.mock.calls[0]?.[0] as ReadonlyArray<{
			requirementId: string;
		}>;
		expect(candidates.map((c) => c.requirementId)).toEqual([
			"session",
			"child-oidc",
		]);

		expect(onChildUnauth).toHaveBeenCalled();
		expect(location.pathname).toBe("/login/child");

		router.destroy();
	});

	it("replace composition on a nested public leaf lets navigation commit despite a parent protected requirement", async () => {
		const plannerHost = createPlannerHost();
		const router = createWebRouter({
			plannerHost,
			navigationAdapter: { prefer: NavigationAdapterKind.History },
			routes: [
				defineWebRoute({
					id: "app",
					requirements: [
						makeCandidate(
							"session",
							"session",
							() => false, // parent unauthenticated
							() => "/login",
						),
					],
					children: [
						defineWebRoute({
							id: "public-zone",
							match: "/public",
							composition: RequirementsClientSetComposition.Replace,
							requirements: [],
						}),
						defineWebRoute({
							id: "private-zone",
							match: "/private",
							requirements: [
								makeCandidate("private", "frontend_oidc", () => true),
							],
						}),
					],
				}),
			],
		});

		// Public navigation: parent's session requirement is replaced away,
		// so the router must commit without redirecting.
		await router.navigate("/public");
		await new Promise((r) => queueMicrotask(() => r(undefined)));
		expect(location.pathname).toBe("/public");

		// Private navigation: parent's session requirement still applies
		// and is unmet, so the router must redirect to `/login`.
		await router.navigate("/private");
		await new Promise((r) => queueMicrotask(() => r(undefined)));
		expect(location.pathname).toBe("/login");

		router.destroy();
	});
});
