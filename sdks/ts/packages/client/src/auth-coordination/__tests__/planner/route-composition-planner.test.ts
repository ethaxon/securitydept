import { describe, expect, it } from "vitest";
import {
	type AuthRequirement,
	createAuthRequirement,
	RequirementPlannerHost,
	RequirementsComposition,
	RouteCompositionRequirementPlanner,
} from "../../index";

const ids = (requirements: readonly AuthRequirement[]): string[] =>
	requirements.map((requirement) => requirement.id);

describe("RouteCompositionRequirementPlanner.fromRootRoute", () => {
	it("folds a matched chain with default merge composition", () => {
		const host = RequirementPlannerHost.fromBehaviour({});
		const planner = RouteCompositionRequirementPlanner.fromRootRoute(host, [
			{
				routeId: "app",
				requirements: [createAuthRequirement({ id: "session" })],
			},
			{
				routeId: "dashboard",
				requirements: [createAuthRequirement({ id: "oidc" })],
			},
		]);

		expect(ids(planner.effectiveRequirements)).toEqual(["session", "oidc"]);
	});

	it("honors replace as a public zone", () => {
		const host = RequirementPlannerHost.fromBehaviour({});
		const planner = RouteCompositionRequirementPlanner.fromRootRoute(host, [
			{
				routeId: "app",
				requirements: [createAuthRequirement({ id: "session" })],
			},
			{
				routeId: "public",
				requirements: [],
				composition: RequirementsComposition.Replace,
			},
		]);

		expect(planner.effectiveRequirements).toEqual([]);
	});

	it("honors inherit (segment adds nothing)", () => {
		const host = RequirementPlannerHost.fromBehaviour({});
		const planner = RouteCompositionRequirementPlanner.fromRootRoute(host, [
			{
				routeId: "app",
				requirements: [createAuthRequirement({ id: "session" })],
			},
			{
				routeId: "child",
				requirements: [createAuthRequirement({ id: "ignored" })],
				composition: RequirementsComposition.Inherit,
			},
		]);

		expect(ids(planner.effectiveRequirements)).toEqual(["session"]);
	});
});

describe("RouteCompositionRequirementPlanner.fromActiveRoute", () => {
	it("preserves shared-prefix resolutions across a transition", async () => {
		const host = RequirementPlannerHost.fromBehaviour({
			checkAuthenticated: (req) => req.id === "session",
			onUnauthenticated: () => false,
		});

		const previous = RouteCompositionRequirementPlanner.fromRootRoute(host, [
			{
				routeId: "app",
				requirements: [createAuthRequirement({ id: "session" })],
			},
			{
				routeId: "dashboard",
				requirements: [createAuthRequirement({ id: "oidc" })],
			},
		]);
		const previousPlan = await previous.buildPlan();
		await previous.checkUnauthenticatedCandidates(previousPlan);
		await previous.runStep(previousPlan);
		expect(previousPlan.resolutionList.map((r) => r.requirementId)).toEqual([
			"session",
		]);

		const next = RouteCompositionRequirementPlanner.fromActiveRoute(
			host,
			[
				{
					routeId: "app",
					requirements: [createAuthRequirement({ id: "session" })],
				},
				{
					routeId: "settings",
					requirements: [createAuthRequirement({ id: "admin" })],
				},
			],
			previous,
			previousPlan,
		);

		const nextPlan = await next.buildPlan();
		expect(nextPlan.resolutionList.map((r) => r.requirementId)).toEqual([
			"session",
		]);
		await next.checkUnauthenticatedCandidates(nextPlan);
		expect(ids(nextPlan.candidateList)).toEqual(["admin"]);

		await next.runStep(nextPlan);
		expect(nextPlan.resolutionList.map((r) => r.requirementId)).toEqual([
			"session",
		]);
	});

	it("drops resolutions for diverging requirements", async () => {
		const host = RequirementPlannerHost.fromBehaviour({
			checkAuthenticated: () => true,
		});

		const previous = RouteCompositionRequirementPlanner.fromRootRoute(host, [
			{ routeId: "app", requirements: [createAuthRequirement({ id: "x" })] },
		]);
		const previousPlan = await previous.buildPlan();
		await previous.checkUnauthenticatedCandidates(previousPlan);
		expect(previousPlan.resolutionList.map((r) => r.requirementId)).toEqual([
			"x",
		]);

		const next = RouteCompositionRequirementPlanner.fromActiveRoute(
			host,
			[
				{
					routeId: "other",
					requirements: [createAuthRequirement({ id: "y" })],
				},
			],
			previous,
			previousPlan,
		);

		expect((await next.buildPlan()).resolutionList).toEqual([]);
	});
});
