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
import { SecuritydeptInjector } from "@securitydept/client/injection";
import {
	AUTH_PLANNER_HOST,
	AUTH_REQUIREMENTS_CLIENT_SET,
	createRequirementsClientSetInjector,
	provideAuthPlannerHost,
	provideRequirementsClientSet,
} from "@securitydept/client-react";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Canonical import shape verification
// ---------------------------------------------------------------------------

describe("@securitydept/client-react root export — canonical shape", () => {
	it("exports planner-host injection tokens and plain factories", () => {
		expect(AUTH_PLANNER_HOST).toBeDefined();
		expect(AUTH_REQUIREMENTS_CLIENT_SET).toBeDefined();
		expect(typeof provideAuthPlannerHost).toBe("function");
		expect(typeof provideRequirementsClientSet).toBe("function");
		expect(typeof createRequirementsClientSetInjector).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// PlannerHost created via provider — contract verification
// ---------------------------------------------------------------------------

describe("planner-host injector factories", () => {
	it("creates a planner-host with default sequential strategy", () => {
		const injector = SecuritydeptInjector.resolveAndCreate([
			provideAuthPlannerHost(),
		]);
		const host = injector.get(AUTH_PLANNER_HOST);
		expect(typeof host.evaluate).toBe("function");
	});

	it("planner-host with custom selector factory option is honored", async () => {
		let selectorCalled = false;
		const injector = SecuritydeptInjector.resolveAndCreate([
			provideAuthPlannerHost({
				selectCandidate: (candidates) => {
					selectorCalled = true;
					return candidates[0];
				},
			}),
		]);
		const host = injector.get(AUTH_PLANNER_HOST);

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
// Requirements client set composition — injector layering semantics
// ---------------------------------------------------------------------------

describe("createRequirementsClientSetInjector — composition semantics", () => {
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
		const parentInjector = SecuritydeptInjector.resolveAndCreate([
			provideRequirementsClientSet([sessionOpt]),
		]);
		const childInjector = createRequirementsClientSetInjector(parentInjector, {
			composition: RequirementsClientSetComposition.Inherit,
			options: [oidcOpt],
		});
		const result = childInjector.get(AUTH_REQUIREMENTS_CLIENT_SET);
		expect(result.map((o) => o.requirementId)).toEqual(["session"]);
	});

	it("merge — appends child options to parent", () => {
		const parentInjector = SecuritydeptInjector.resolveAndCreate([
			provideRequirementsClientSet([sessionOpt]),
		]);
		const childInjector = createRequirementsClientSetInjector(parentInjector, {
			composition: RequirementsClientSetComposition.Merge,
			options: [oidcOpt],
		});
		const result = childInjector.get(AUTH_REQUIREMENTS_CLIENT_SET);
		expect(result.map((o) => o.requirementId)).toEqual(["session", "oidc"]);
	});

	it("replace — discards parent, uses child only", () => {
		const parentInjector = SecuritydeptInjector.resolveAndCreate([
			provideRequirementsClientSet([sessionOpt]),
		]);
		const childInjector = createRequirementsClientSetInjector(parentInjector, {
			composition: RequirementsClientSetComposition.Replace,
			options: [oidcOpt],
		});
		const result = childInjector.get(AUTH_REQUIREMENTS_CLIENT_SET);
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

		const injector = SecuritydeptInjector.resolveAndCreate([
			provideAuthPlannerHost(),
		]);
		const host = injector.get(AUTH_PLANNER_HOST);
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

		const injector = SecuritydeptInjector.resolveAndCreate([
			provideAuthPlannerHost(),
		]);
		const host = injector.get(AUTH_PLANNER_HOST);
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

		const injector = SecuritydeptInjector.resolveAndCreate([
			provideAuthPlannerHost({
				selectCandidate: async (candidates) => {
					await Promise.resolve();
					return [...candidates].sort(
						(a, b) =>
							((b.attributes?.priority as number) ?? 0) -
							((a.attributes?.priority as number) ?? 0),
					)[0];
				},
			}),
		]);
		const host = injector.get(AUTH_PLANNER_HOST);

		const result = await host.evaluate([lowPriority, highPriority]);
		expect(result.pendingCandidate?.requirementId).toBe("high");
	});
});
