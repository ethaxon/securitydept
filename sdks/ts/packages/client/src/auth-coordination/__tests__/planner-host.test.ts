import { describe, expect, it } from "vitest";
import {
	type AuthRequirement,
	createAuthRequirement,
	RequirementPlannerHost,
	StaticRequirementPlanner,
} from "../index";

describe("RequirementPlannerHost behaviour defaults", () => {
	it("defaults: nothing authenticated, block on unauthenticated", async () => {
		const host = RequirementPlannerHost.fromBehaviour({});
		const planner = StaticRequirementPlanner.fromRequirements(host, [
			createAuthRequirement({ id: "a" }),
		]);

		const result = await planner.runUntilSettled();
		expect(result.outcome).toBe("blocked");
	});

	it("default selectCandidate picks the first candidate", async () => {
		const host = RequirementPlannerHost.fromBehaviour({
			checkAuthenticated: () => false,
			onUnauthenticated: () => false,
		});
		const planner = StaticRequirementPlanner.fromRequirements(host, [
			createAuthRequirement({ id: "first" }),
			createAuthRequirement({ id: "second" }),
		]);

		const plan = await planner.buildPlan();
		await planner.checkUnauthenticatedCandidates(plan);
		const step = await planner.runStep(plan);
		expect(step.outcome).toBe("blocked");
		if (step.outcome === "blocked") {
			expect(step.requirement.id).toBe("first");
		}
	});
});

describe("RequirementPlannerHost parent chain", () => {
	it("inherits checkAuthenticated/onUnauthenticated, overrides selectCandidate", async () => {
		const root = RequirementPlannerHost.fromBehaviour({
			checkAuthenticated: () => false,
			onUnauthenticated: () => "/login",
		});
		const child = RequirementPlannerHost.fromBehaviour(
			{
				selectCandidate: (ctx): AuthRequirement =>
					ctx.candidateList[ctx.candidateList.length - 1],
			},
			{ parent: root },
		);

		const planner = StaticRequirementPlanner.fromRequirements(child, [
			createAuthRequirement({ id: "a" }),
			createAuthRequirement({ id: "b" }),
		]);

		const plan = await planner.buildPlan();
		await planner.checkUnauthenticatedCandidates(plan);
		const step = await planner.runStep(plan);
		// inherited onUnauthenticated -> redirect; overridden chooser -> last
		expect(step.outcome).toBe("redirect");
		if (step.outcome === "redirect") {
			expect(step.requirement.id).toBe("b");
			expect(step.location).toBe("/login");
		}
	});

	it("falls through multiple levels to the nearest definition", async () => {
		const root = RequirementPlannerHost.fromBehaviour({
			onUnauthenticated: () => "/root",
		});
		const mid = RequirementPlannerHost.fromBehaviour({}, { parent: root });
		const leaf = RequirementPlannerHost.fromBehaviour({}, { parent: mid });

		const resolved = await leaf.resolveOnUnauthenticated();
		expect(
			resolved(createAuthRequirement({ id: "x" }), {
				requirements: [],
				candidateList: [],
				resolutionList: [],
			}),
		).toBe("/root");
	});
});
