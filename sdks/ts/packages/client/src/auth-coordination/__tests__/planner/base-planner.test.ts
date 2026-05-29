import { describe, expect, it, vi } from "vitest";
import {
	type AuthRequirement,
	createAuthRequirement,
	RequirementPlannerHost,
	StaticRequirementPlanner,
} from "../../index";

const ids = (requirements: readonly AuthRequirement[]): string[] =>
	requirements.map((requirement) => requirement.id);

async function prepareAndRunStep(
	planner: StaticRequirementPlanner,
): Promise<Awaited<ReturnType<StaticRequirementPlanner["runStep"]>>> {
	const plan = await planner.buildPlan();
	await planner.checkUnauthenticatedCandidates(plan);
	return planner.runStep(plan);
}

describe("BaseRequirementPlanner pipeline (via StaticRequirementPlanner)", () => {
	it("step 1 checks concurrently without sequential prefix auto-resolve", async () => {
		const host = RequirementPlannerHost.fromBehaviour({
			checkAuthenticated: (req) => req.id === "b",
			onUnauthenticated: () => false,
		});
		const planner = StaticRequirementPlanner.fromRequirements(host, [
			createAuthRequirement({ id: "a" }),
			createAuthRequirement({ id: "b" }),
			createAuthRequirement({ id: "c" }),
		]);

		const plan = await planner.buildPlan();
		await planner.checkUnauthenticatedCandidates(plan);

		expect(ids(plan.candidateList)).toEqual(["a", "c"]);
		expect(plan.resolutionList.map((r) => r.requirementId)).toEqual(["b"]);

		const step = await planner.runStep(plan);
		expect(step.outcome).toBe("blocked");
		if (step.outcome === "blocked") {
			expect(step.requirement.id).toBe("a");
		}
	});

	it("runs checkAuthenticated concurrently in step 1", async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		const host = RequirementPlannerHost.fromBehaviour({
			checkAuthenticated: async () => {
				inFlight += 1;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await Promise.resolve();
				inFlight -= 1;
				return false;
			},
			onUnauthenticated: () => false,
		});
		const planner = StaticRequirementPlanner.fromRequirements(host, [
			createAuthRequirement({ id: "a" }),
			createAuthRequirement({ id: "b" }),
			createAuthRequirement({ id: "c" }),
		]);

		const plan = await planner.buildPlan();
		await planner.checkUnauthenticatedCandidates(plan);
		expect(maxInFlight).toBeGreaterThan(1);
	});

	it("runStep reduces one candidate when the action fulfills it", async () => {
		const host = RequirementPlannerHost.fromBehaviour({
			checkAuthenticated: () => false,
			onUnauthenticated: () => true,
		});
		const planner = StaticRequirementPlanner.fromRequirements(host, [
			createAuthRequirement({ id: "a" }),
			createAuthRequirement({ id: "b" }),
		]);

		const plan = await planner.buildPlan();
		await planner.checkUnauthenticatedCandidates(plan);
		const step = await planner.runStep(plan);
		expect(step.outcome).toBe("resolved");
		if (step.outcome === "resolved") {
			expect(step.requirement.id).toBe("a");
		}
		expect(plan.resolutionList.map((r) => r.requirementId)).toEqual(["a"]);
		expect(ids(plan.candidateList)).toEqual(["b"]);
	});

	it("runUntilSettled runs buildPlan, step 1, then loops step 2", async () => {
		const host = RequirementPlannerHost.fromBehaviour({
			checkAuthenticated: () => false,
			onUnauthenticated: () => true,
		});
		const planner = StaticRequirementPlanner.fromRequirements(host, [
			createAuthRequirement({ id: "a" }),
			createAuthRequirement({ id: "b" }),
			createAuthRequirement({ id: "c" }),
		]);

		const result = await planner.runUntilSettled();
		expect(result.outcome).toBe("settled");
		if (result.outcome === "settled") {
			expect(result.resolutions.map((r) => r.requirementId)).toEqual([
				"a",
				"b",
				"c",
			]);
		}
	});

	it("runUntilSettled stops at a redirect", async () => {
		const onUnauthenticated = vi.fn(() => "/login");
		const host = RequirementPlannerHost.fromBehaviour({
			checkAuthenticated: () => false,
			onUnauthenticated,
		});
		const planner = StaticRequirementPlanner.fromRequirements(host, [
			createAuthRequirement({ id: "a" }),
			createAuthRequirement({ id: "b" }),
		]);

		const result = await planner.runUntilSettled();
		expect(result.outcome).toBe("redirect");
		if (result.outcome === "redirect") {
			expect(result.requirement.id).toBe("a");
			expect(result.location).toBe("/login");
		}
		expect(onUnauthenticated).toHaveBeenCalledTimes(1);
	});

	it("settles immediately when everything is authenticated", async () => {
		const host = RequirementPlannerHost.fromBehaviour({
			checkAuthenticated: () => true,
		});
		const planner = StaticRequirementPlanner.fromRequirements(host, [
			createAuthRequirement({ id: "a" }),
			createAuthRequirement({ id: "b" }),
		]);

		const result = await planner.runUntilSettled();
		expect(result.outcome).toBe("settled");
		if (result.outcome === "settled") {
			expect(result.resolutions.map((r) => r.requirementId)).toEqual([
				"a",
				"b",
			]);
		}
	});

	it("settles an empty requirement list after buildPlan and step 1", async () => {
		const host = RequirementPlannerHost.fromBehaviour({});
		const planner = StaticRequirementPlanner.fromRequirements(host, []);

		const result = await planner.runUntilSettled();
		expect(result.outcome).toBe("settled");
	});

	it("selectCandidate only sees unsatisfied requirements after step 1", async () => {
		const seen: string[][] = [];
		const host = RequirementPlannerHost.fromBehaviour({
			checkAuthenticated: (req) => req.id === "authed",
			onUnauthenticated: () => false,
			selectCandidate: (ctx) => {
				seen.push(ids(ctx.candidateList));
				return ctx.candidateList[0];
			},
		});
		const planner = StaticRequirementPlanner.fromRequirements(host, [
			createAuthRequirement({ id: "authed" }),
			createAuthRequirement({ id: "pending" }),
		]);

		await prepareAndRunStep(planner);
		expect(seen).toEqual([["pending"]]);
	});

	it("binds behaviour once per buildPlan, not per step", async () => {
		let resolveCount = 0;
		const host = {
			resolveCheckAuthenticated: async () => {
				resolveCount += 1;
				return () => true;
			},
			resolveOnUnauthenticated: async () => () => false,
			resolveSelectCandidate: async () => (ctx) => ctx.candidateList[0],
		} as RequirementPlannerHost;

		const planner = StaticRequirementPlanner.fromRequirements(host, [
			createAuthRequirement({ id: "a" }),
			createAuthRequirement({ id: "b" }),
		]);

		const plan = await planner.buildPlan();
		await planner.checkUnauthenticatedCandidates(plan);
		await planner.runStep(plan);
		expect(resolveCount).toBe(1);

		await planner.buildPlan();
		expect(resolveCount).toBe(2);
	});
});
