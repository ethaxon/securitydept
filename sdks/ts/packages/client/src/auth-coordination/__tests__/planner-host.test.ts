import { describe, expect, it, vi } from "vitest";
import {
	type AuthGuardClientOption,
	createPlannerHost,
	RequirementsClientSetComposition,
	resolveEffectiveClientSet,
	type ScopedRequirementsClientSet,
} from "../planner-host";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeOption(
	overrides: Partial<AuthGuardClientOption> & { requirementId: string },
): AuthGuardClientOption {
	return {
		requirementKind: "test",
		checkAuthenticated: () => false,
		onUnauthenticated: () => false,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// resolveEffectiveClientSet
// ---------------------------------------------------------------------------

describe("resolveEffectiveClientSet", () => {
	const parentA = makeOption({
		requirementId: "a",
		requirementKind: "session",
	});
	const parentB = makeOption({ requirementId: "b", requirementKind: "oidc" });

	it("inherit — returns parent options unchanged", () => {
		const child: ScopedRequirementsClientSet = {
			composition: RequirementsClientSetComposition.Inherit,
			options: [makeOption({ requirementId: "c" })],
		};
		const result = resolveEffectiveClientSet([parentA, parentB], child);
		expect(result.map((o) => o.requirementId)).toEqual(["a", "b"]);
	});

	it("merge — parent options plus child additions", () => {
		const childC = makeOption({
			requirementId: "c",
			requirementKind: "custom",
		});
		const child: ScopedRequirementsClientSet = {
			composition: RequirementsClientSetComposition.Merge,
			options: [childC],
		};
		const result = resolveEffectiveClientSet([parentA, parentB], child);
		expect(result.map((o) => o.requirementId)).toEqual(["a", "b", "c"]);
	});

	it("merge — child overrides parent option with same requirementId", () => {
		const overriddenA = makeOption({
			requirementId: "a",
			requirementKind: "overridden",
		});
		const child: ScopedRequirementsClientSet = {
			composition: RequirementsClientSetComposition.Merge,
			options: [overriddenA],
		};
		const result = resolveEffectiveClientSet([parentA, parentB], child);
		expect(result.map((o) => o.requirementId)).toEqual(["a", "b"]);
		expect(result[0].requirementKind).toBe("overridden");
	});

	it("replace — discards parent, uses child only", () => {
		const childD = makeOption({ requirementId: "d" });
		const child: ScopedRequirementsClientSet = {
			composition: RequirementsClientSetComposition.Replace,
			options: [childD],
		};
		const result = resolveEffectiveClientSet([parentA, parentB], child);
		expect(result.map((o) => o.requirementId)).toEqual(["d"]);
	});

	it("inherit — with empty parent returns empty", () => {
		const child: ScopedRequirementsClientSet = {
			composition: RequirementsClientSetComposition.Inherit,
			options: [],
		};
		const result = resolveEffectiveClientSet([], child);
		expect(result).toEqual([]);
	});

	it("merge — with empty parent uses child only", () => {
		const childE = makeOption({ requirementId: "e" });
		const child: ScopedRequirementsClientSet = {
			composition: RequirementsClientSetComposition.Merge,
			options: [childE],
		};
		const result = resolveEffectiveClientSet([], child);
		expect(result.map((o) => o.requirementId)).toEqual(["e"]);
	});
});

// ---------------------------------------------------------------------------
// createPlannerHost — default strategy
// ---------------------------------------------------------------------------

describe("createPlannerHost (default strategy)", () => {
	it("returns allAuthenticated=true when all candidates pass", async () => {
		const host = createPlannerHost();
		const result = await host.evaluate([
			makeOption({ requirementId: "a", checkAuthenticated: () => true }),
			makeOption({ requirementId: "b", checkAuthenticated: () => true }),
		]);
		expect(result.allAuthenticated).toBe(true);
		expect(result.pendingCandidate).toBeNull();
		expect(result.unauthenticatedCandidates).toHaveLength(0);
	});

	it("selects the first unauthenticated candidate by default", async () => {
		const host = createPlannerHost();
		const result = await host.evaluate([
			makeOption({ requirementId: "a", checkAuthenticated: () => true }),
			makeOption({ requirementId: "b", checkAuthenticated: () => false }),
			makeOption({ requirementId: "c", checkAuthenticated: () => false }),
		]);
		expect(result.allAuthenticated).toBe(false);
		expect(result.pendingCandidate?.requirementId).toBe("b");
		expect(result.unauthenticatedCandidates).toHaveLength(2);
	});

	it("selects the first when all are unauthenticated", async () => {
		const host = createPlannerHost();
		const result = await host.evaluate([
			makeOption({ requirementId: "x", checkAuthenticated: () => false }),
			makeOption({ requirementId: "y", checkAuthenticated: () => false }),
		]);
		expect(result.pendingCandidate?.requirementId).toBe("x");
	});

	it("handles single candidate", async () => {
		const host = createPlannerHost();
		const result = await host.evaluate([
			makeOption({ requirementId: "solo", checkAuthenticated: () => false }),
		]);
		expect(result.pendingCandidate?.requirementId).toBe("solo");
	});
});

// ---------------------------------------------------------------------------
// createPlannerHost — custom selection strategy
// ---------------------------------------------------------------------------

describe("createPlannerHost (custom selectCandidate)", () => {
	it("uses the custom selector to pick the pending candidate", async () => {
		const host = createPlannerHost({
			// Custom: always pick the LAST unauthenticated candidate
			selectCandidate: (candidates) => candidates[candidates.length - 1],
		});
		const result = await host.evaluate([
			makeOption({ requirementId: "first", checkAuthenticated: () => false }),
			makeOption({ requirementId: "second", checkAuthenticated: () => false }),
			makeOption({ requirementId: "third", checkAuthenticated: () => false }),
		]);
		expect(result.pendingCandidate?.requirementId).toBe("third");
	});

	it("custom selector receives only unauthenticated candidates", async () => {
		const selectorSpy = vi.fn(
			(candidates: readonly AuthGuardClientOption[]) => candidates[0],
		);
		const host = createPlannerHost({ selectCandidate: selectorSpy });
		await host.evaluate([
			makeOption({ requirementId: "authed", checkAuthenticated: () => true }),
			makeOption({
				requirementId: "unauthed",
				checkAuthenticated: () => false,
			}),
		]);
		expect(selectorSpy).toHaveBeenCalledTimes(1);
		expect(selectorSpy.mock.calls[0][0]).toHaveLength(1);
		expect(selectorSpy.mock.calls[0][0][0].requirementId).toBe("unauthed");
	});

	it("custom selector is not called when all are authenticated", async () => {
		const selectorSpy = vi.fn(
			(candidates: readonly AuthGuardClientOption[]) => candidates[0],
		);
		const host = createPlannerHost({ selectCandidate: selectorSpy });
		await host.evaluate([
			makeOption({ requirementId: "a", checkAuthenticated: () => true }),
		]);
		expect(selectorSpy).not.toHaveBeenCalled();
	});

	it("async selector — simulates chooser dialog waiting for user input", async () => {
		// Simulates an async chooser: resolves after a microtask (like awaiting a dialog).
		// The selector picks the candidate with the highest 'priority' attribute.
		const asyncSelector = async (
			candidates: readonly AuthGuardClientOption[],
		): Promise<AuthGuardClientOption> => {
			// Simulate async work (e.g. dialog shown, user picks)
			await Promise.resolve();
			return [...candidates].sort(
				(a, b) =>
					((b.attributes?.priority as number) ?? 0) -
					((a.attributes?.priority as number) ?? 0),
			)[0];
		};

		const host = createPlannerHost({ selectCandidate: asyncSelector });
		const result = await host.evaluate([
			makeOption({
				requirementId: "low-priority",
				checkAuthenticated: () => false,
				attributes: { priority: 1 },
			}),
			makeOption({
				requirementId: "high-priority",
				checkAuthenticated: () => false,
				attributes: { priority: 10 },
			}),
		]);
		expect(result.pendingCandidate?.requirementId).toBe("high-priority");
	});
});

// ---------------------------------------------------------------------------
// Integration: resolveEffectiveClientSet + PlannerHost
// ---------------------------------------------------------------------------

describe("planner-host integration with client set composition", () => {
	it("app-level planner + sub-route merge + planner evaluate", async () => {
		// App-level: session requirement (authenticated)
		const sessionOpt = makeOption({
			requirementId: "session",
			requirementKind: "session",
			checkAuthenticated: () => true,
		});

		// Feature-route: OIDC requirement (not yet authenticated)
		const oidcOpt = makeOption({
			requirementId: "confluence-oidc",
			requirementKind: "frontend_oidc",
			checkAuthenticated: () => false,
			onUnauthenticated: () => "/login/confluence",
		});

		// Merge child into parent
		const effective = resolveEffectiveClientSet([sessionOpt], {
			composition: RequirementsClientSetComposition.Merge,
			options: [oidcOpt],
		});

		// Planner evaluates
		const host = createPlannerHost();
		const result = await host.evaluate(effective);

		expect(result.allAuthenticated).toBe(false);
		expect(result.pendingCandidate?.requirementId).toBe("confluence-oidc");
		expect(result.unauthenticatedCandidates).toHaveLength(1);
	});

	it("sub-route replace discards parent requirements", async () => {
		const sessionOpt = makeOption({
			requirementId: "session",
			checkAuthenticated: () => false,
		});
		const publicOpt = makeOption({
			requirementId: "public",
			checkAuthenticated: () => true,
		});

		const effective = resolveEffectiveClientSet([sessionOpt], {
			composition: RequirementsClientSetComposition.Replace,
			options: [publicOpt],
		});

		const host = createPlannerHost();
		const result = await host.evaluate(effective);

		expect(result.allAuthenticated).toBe(true);
		expect(result.pendingCandidate).toBeNull();
	});
});
