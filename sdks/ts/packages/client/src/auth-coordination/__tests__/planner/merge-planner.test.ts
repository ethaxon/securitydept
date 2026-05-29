import { describe, expect, it } from "vitest";
import {
	createAuthRequirement,
	MergeRequirementPlanner,
	RequirementPlannerHost,
	StaticRequirementPlanner,
} from "../../index";

describe("MergeRequirementPlanner", () => {
	it("concatenates source requirement lists in order", async () => {
		const host = RequirementPlannerHost.fromBehaviour({
			checkAuthenticated: () => false,
			onUnauthenticated: () => false,
		});
		const first = StaticRequirementPlanner.fromRequirements(host, [
			createAuthRequirement({ id: "a" }),
		]);
		const second = StaticRequirementPlanner.fromRequirements(host, [
			createAuthRequirement({ id: "b" }),
			createAuthRequirement({ id: "c" }),
		]);

		const merge = MergeRequirementPlanner.fromPlanners(host, [first, second]);
		expect((await merge.resolveRequirementList()).map((r) => r.id)).toEqual([
			"a",
			"b",
			"c",
		]);

		const result = await merge.runUntilSettled();
		expect(result.outcome).toBe("blocked");
		if (result.outcome === "blocked") {
			expect(result.requirement.id).toBe("a");
		}
	});

	it("reflects source order when sources are swapped", async () => {
		const host = RequirementPlannerHost.fromBehaviour({});
		const first = StaticRequirementPlanner.fromRequirements(host, [
			createAuthRequirement({ id: "a" }),
		]);
		const second = StaticRequirementPlanner.fromRequirements(host, [
			createAuthRequirement({ id: "b" }),
		]);

		const merge = MergeRequirementPlanner.fromPlanners(host, [second, first]);
		expect((await merge.resolveRequirementList()).map((r) => r.id)).toEqual([
			"b",
			"a",
		]);
	});
});
