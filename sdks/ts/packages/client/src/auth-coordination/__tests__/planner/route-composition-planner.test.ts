import { describe, expect, it } from "vitest";
import { createEnvironmentForTest } from "../../../test";
import {
	type AuthRequirement,
	type RequirementBehaviourWithRouteContext,
	RequirementPlannerHost,
	RequirementsComposition,
	RouteCompositionRequirementPlanner,
	StaticAttrsAuthRequirement,
} from "../../index";

const ids = (requirements: readonly AuthRequirement[]): string[] =>
	requirements.map((requirement) => requirement.id);

const routeState = { url: "/app/dashboard" };

describe("RouteCompositionRequirementPlanner.fromRouteSegments", () => {
	it("folds a matched chain with default merge composition", () => {
		const host = RequirementPlannerHost.fromBehaviour({});
		const planner = RouteCompositionRequirementPlanner.fromRouteSegments(
			host,
			[
				{
					routeId: "app",
					requirements: [StaticAttrsAuthRequirement.create({ id: "session" })],
				},
				{
					routeId: "dashboard",
					requirements: [StaticAttrsAuthRequirement.create({ id: "oidc" })],
				},
			],
			routeState,
		);

		expect(ids(planner.effectiveRequirements)).toEqual(["session", "oidc"]);
	});

	it("honors replace as a public zone", () => {
		const host = RequirementPlannerHost.fromBehaviour({});
		const planner = RouteCompositionRequirementPlanner.fromRouteSegments(
			host,
			[
				{
					routeId: "app",
					requirements: [StaticAttrsAuthRequirement.create({ id: "session" })],
				},
				{
					routeId: "public",
					requirements: [],
					composition: RequirementsComposition.Replace,
				},
			],
			routeState,
		);

		expect(planner.effectiveRequirements).toEqual([]);
	});

	it("honors inherit (segment adds nothing)", () => {
		const host = RequirementPlannerHost.fromBehaviour({});
		const planner = RouteCompositionRequirementPlanner.fromRouteSegments(
			host,
			[
				{
					routeId: "app",
					requirements: [StaticAttrsAuthRequirement.create({ id: "session" })],
				},
				{
					routeId: "child",
					requirements: [StaticAttrsAuthRequirement.create({ id: "ignored" })],
					composition: RequirementsComposition.Inherit,
				},
			],
			routeState,
		);

		expect(ids(planner.effectiveRequirements)).toEqual(["session"]);
	});
});

describe("RouteCompositionRequirementPlanner.fromRouteTransition", () => {
	it("preserves shared-prefix resolutions across a transition", async () => {
		const host = RequirementPlannerHost.fromBehaviour(
			{
				checkAuthenticated: (req) => req.id === "session",
				onUnauthenticated: () => false,
			},
			{
				environment: createEnvironmentForTest(),
			},
		);

		const previous = RouteCompositionRequirementPlanner.fromRouteSegments(
			host,
			[
				{
					routeId: "app",
					requirements: [StaticAttrsAuthRequirement.create({ id: "session" })],
				},
				{
					routeId: "dashboard",
					requirements: [StaticAttrsAuthRequirement.create({ id: "oidc" })],
				},
			],
			routeState,
		);
		const previousPlan = await previous.buildPlan();
		await previous.runStep(previousPlan);
		expect(previousPlan.resolutionList.map((r) => r.requirementId)).toEqual([
			"session",
		]);

		const next = RouteCompositionRequirementPlanner.fromRouteTransition(
			host,
			[
				{
					routeId: "app",
					requirements: [StaticAttrsAuthRequirement.create({ id: "session" })],
				},
				{
					routeId: "settings",
					requirements: [StaticAttrsAuthRequirement.create({ id: "admin" })],
				},
			],
			{ url: "/app/settings" },
			previous,
			previousPlan,
		);

		const nextPlan = await next.buildPlan();
		expect(nextPlan.resolutionList.map((r) => r.requirementId)).toEqual([
			"session",
		]);
		const step = await next.runStep(nextPlan);
		expect(step.outcome).toBe("blocked");
		if (step.outcome === "blocked") {
			expect(step.requirement.id).toBe("admin");
		}
		expect(nextPlan.resolutionList.map((r) => r.requirementId)).toEqual([
			"session",
		]);
	});

	it("drops resolutions for diverging requirements", async () => {
		const host = RequirementPlannerHost.fromBehaviour(
			{
				checkAuthenticated: () => true,
				onUnauthenticated: () => false,
			},
			{
				environment: createEnvironmentForTest(),
			},
		);

		const previous = RouteCompositionRequirementPlanner.fromRouteSegments(
			host,
			[
				{
					routeId: "app",
					requirements: [StaticAttrsAuthRequirement.create({ id: "x" })],
				},
			],
			routeState,
		);
		const previousPlan = await previous.buildPlan();
		await previous.runStep(previousPlan);
		expect(previousPlan.resolutionList.map((r) => r.requirementId)).toEqual([
			"x",
		]);

		const next = RouteCompositionRequirementPlanner.fromRouteTransition(
			host,
			[
				{
					routeId: "other",
					requirements: [StaticAttrsAuthRequirement.create({ id: "y" })],
				},
			],
			{ url: "/other" },
			previous,
			previousPlan,
		);

		expect((await next.buildPlan()).resolutionList).toEqual([]);
	});

	it("passes route state to behaviour contexts", async () => {
		const seen: string[] = [];
		const host = RequirementPlannerHost.fromBehaviour<
			Partial<RequirementBehaviourWithRouteContext<StaticAttrsAuthRequirement>>
		>(
			{
				checkAuthenticated: (_requirement, context) => {
					seen.push(context.planContext.routeState.url);
					return true;
				},
				onUnauthenticated: () => false,
			},
			{
				environment: createEnvironmentForTest(),
			},
		);
		const planner = RouteCompositionRequirementPlanner.fromRouteSegments(
			host,
			[
				{
					routeId: "app",
					requirements: [StaticAttrsAuthRequirement.create({ id: "session" })],
				},
			],
			{ url: "/app/profile" },
		);

		await planner.runStep(await planner.buildPlan());

		expect(seen).toEqual(["/app/profile"]);
	});
});
