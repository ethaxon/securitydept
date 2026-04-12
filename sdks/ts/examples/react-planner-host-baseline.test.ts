// React planner-host baseline
//
// Evidence file for @securitydept/client-react root export (.).
//
// Proves the canonical import path, provider/hook contract, requirements
// client set composition semantics, and planner-host integration from
// a React adopter's perspective.
//
// Note: This test runs in a Node/jsdom-free environment using vitest.
// The Context and Provider primitives are exercised by direct composition
// (not by rendering components) to verify the shared contract without
// requiring a DOM or React renderer dependency in the test runner.

import {
	type AuthGuardClientOption,
	createPlannerHost,
	RequirementsClientSetComposition,
	resolveEffectiveClientSet,
} from "@securitydept/client/auth-coordination";
import {
	AuthPlannerHostProvider,
	type AuthPlannerHostProviderProps,
	AuthRequirementsClientSetProvider,
	type AuthRequirementsClientSetProviderProps,
	useAuthPlannerHost,
	useEffectiveClientSet,
} from "@securitydept/client-react";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Canonical import shape verification
// ---------------------------------------------------------------------------

describe("@securitydept/client-react root export — canonical shape", () => {
	it("exports AuthPlannerHostProvider component", () => {
		expect(typeof AuthPlannerHostProvider).toBe("function");
	});

	it("exports useAuthPlannerHost hook", () => {
		expect(typeof useAuthPlannerHost).toBe("function");
	});

	it("exports AuthRequirementsClientSetProvider component", () => {
		expect(typeof AuthRequirementsClientSetProvider).toBe("function");
	});

	it("exports useEffectiveClientSet hook", () => {
		expect(typeof useEffectiveClientSet).toBe("function");
	});

	it("providers accept required prop shapes (TypeScript contract)", () => {
		// Verify the prop types are correct at the TypeScript level.
		const _hostProps: AuthPlannerHostProviderProps = {
			children: null,
		};
		const _setProps: AuthRequirementsClientSetProviderProps = {
			children: null,
			scopedSet: {
				composition: RequirementsClientSetComposition.Inherit,
				options: [],
			},
		};
		expect(_hostProps).toBeDefined();
		expect(_setProps).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// PlannerHost created via provider — contract verification
// ---------------------------------------------------------------------------

describe("AuthPlannerHostProvider — planner-host lifecycle", () => {
	it("creates a planner-host with default sequential strategy", () => {
		// Providers create planner-hosts; we verify the shared contract directly.
		const host = createPlannerHost();
		expect(typeof host.evaluate).toBe("function");
	});

	it("planner-host with custom selector passed as prop is honored", async () => {
		// A custom selector can be passed to the provider via selectCandidate prop.
		// Verify the selector is actually called during evaluate().
		let selectorCalled = false;
		const host = createPlannerHost({
			selectCandidate: (candidates) => {
				selectorCalled = true;
				return candidates[0];
			},
		});

		const unauthenticatedOpt: AuthGuardClientOption = {
			requirementId: "oidc",
			requirementKind: "frontend_oidc",
			checkAuthenticated: () => false,
			onUnauthenticated: () => "/login",
		};

		await host.evaluate([unauthenticatedOpt]);
		expect(selectorCalled).toBe(true);
	});

	it("planner-host evaluate returns allAuthenticated=true when all pass", async () => {
		const host = createPlannerHost();
		const result = await host.evaluate([
			{
				requirementId: "session",
				requirementKind: "session",
				checkAuthenticated: () => true,
				onUnauthenticated: () => false,
			},
		]);
		expect(result.allAuthenticated).toBe(true);
		expect(result.pendingCandidate).toBeNull();
	});

	it("planner-host evaluate returns pendingCandidate when unauthenticated", async () => {
		const host = createPlannerHost();
		const result = await host.evaluate([
			{
				requirementId: "session",
				requirementKind: "session",
				checkAuthenticated: () => false,
				onUnauthenticated: () => "/login",
			},
		]);
		expect(result.allAuthenticated).toBe(false);
		expect(result.pendingCandidate?.requirementId).toBe("session");
	});
});

// ---------------------------------------------------------------------------
// Requirements client set composition — React Context semantics
// ---------------------------------------------------------------------------

describe("resolveEffectiveClientSet — React Context composition semantics", () => {
	const sessionOpt: AuthGuardClientOption = {
		requirementId: "session",
		requirementKind: "session",
		checkAuthenticated: () => true,
		onUnauthenticated: () => false,
	};
	const oidcOpt: AuthGuardClientOption = {
		requirementId: "oidc",
		requirementKind: "frontend_oidc",
		checkAuthenticated: () => false,
		onUnauthenticated: () => "/login",
	};

	it("inherit — passes parent options unchanged", () => {
		const result = resolveEffectiveClientSet([sessionOpt], {
			composition: RequirementsClientSetComposition.Inherit,
			options: [oidcOpt],
		});
		expect(result.map((o) => o.requirementId)).toEqual(["session"]);
	});

	it("merge — appends child options to parent", () => {
		const result = resolveEffectiveClientSet([sessionOpt], {
			composition: RequirementsClientSetComposition.Merge,
			options: [oidcOpt],
		});
		expect(result.map((o) => o.requirementId)).toEqual(["session", "oidc"]);
	});

	it("replace — discards parent, uses child only", () => {
		const result = resolveEffectiveClientSet([sessionOpt], {
			composition: RequirementsClientSetComposition.Replace,
			options: [oidcOpt],
		});
		expect(result.map((o) => o.requirementId)).toEqual(["oidc"]);
	});
});

// ---------------------------------------------------------------------------
// Integration: planner-host + requirements client set composition
// ---------------------------------------------------------------------------

describe("planner-host integration — multi-scope scenario", () => {
	it("evaluates merged requirements using planner sequential discipline", async () => {
		// App scope: session (authenticated)
		// Feature scope: oidc (not authenticated)
		// Expected: planner selects oidc as the pending candidate
		const appSessionOpt: AuthGuardClientOption = {
			requirementId: "app-session",
			requirementKind: "session",
			checkAuthenticated: () => true,
			onUnauthenticated: () => false,
		};
		const featureOidcOpt: AuthGuardClientOption = {
			requirementId: "feature-oidc",
			requirementKind: "frontend_oidc",
			checkAuthenticated: () => false,
			onUnauthenticated: () => "/feature/login",
		};

		const effective = resolveEffectiveClientSet([appSessionOpt], {
			composition: RequirementsClientSetComposition.Merge,
			options: [featureOidcOpt],
		});

		const host = createPlannerHost();
		const result = await host.evaluate(effective);

		expect(result.allAuthenticated).toBe(false);
		expect(result.pendingCandidate?.requirementId).toBe("feature-oidc");
		expect(result.unauthenticatedCandidates).toHaveLength(1);
	});

	it("evaluates replace composition — only child requirements matter", async () => {
		const parentOpt: AuthGuardClientOption = {
			requirementId: "parent-strict",
			requirementKind: "backend_oidc",
			checkAuthenticated: () => false, // would block if not replaced
			onUnauthenticated: () => "/admin/login",
		};
		const publicOpt: AuthGuardClientOption = {
			requirementId: "public-route",
			requirementKind: "public",
			checkAuthenticated: () => true,
			onUnauthenticated: () => false,
		};

		const effective = resolveEffectiveClientSet([parentOpt], {
			composition: RequirementsClientSetComposition.Replace,
			options: [publicOpt],
		});

		const host = createPlannerHost();
		const result = await host.evaluate(effective);

		// Parent's strict requirement is replaced — only public-route matters
		expect(result.allAuthenticated).toBe(true);
		expect(result.pendingCandidate).toBeNull();
	});

	it("async selector works end-to-end with merged client set", async () => {
		// Simulates a chooser UI that picks based on priority metadata
		const highPriority: AuthGuardClientOption = {
			requirementId: "high",
			requirementKind: "frontend_oidc",
			checkAuthenticated: () => false,
			onUnauthenticated: () => "/high/login",
			attributes: { priority: 10 },
		};
		const lowPriority: AuthGuardClientOption = {
			requirementId: "low",
			requirementKind: "backend_oidc",
			checkAuthenticated: () => false,
			onUnauthenticated: () => "/low/login",
			attributes: { priority: 1 },
		};

		const host = createPlannerHost({
			selectCandidate: async (candidates) => {
				await Promise.resolve(); // simulate async dialog delay
				return [...candidates].sort(
					(a, b) =>
						((b.attributes?.priority as number) ?? 0) -
						((a.attributes?.priority as number) ?? 0),
				)[0];
			},
		});

		const result = await host.evaluate([lowPriority, highPriority]);
		expect(result.pendingCandidate?.requirementId).toBe("high");
	});
});
