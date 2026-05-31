import { describe, expect, it, vi } from "vitest";
import { createEnvironmentForTest } from "../../../test";
import {
	type AuthRequirement,
	type RequirementBehaviour,
	type RequirementCandidateGenerator,
	RequirementPlannerHost,
	type RequirementPlannerHostOptions,
	StaticAttrsAuthRequirement,
	StaticRequirementPlanner,
} from "../../index";

const ids = (requirements: readonly AuthRequirement[]): string[] =>
	requirements.map((requirement) => requirement.id);

async function collectCandidates<TAuthRequirement extends AuthRequirement>(
	candidates: RequirementCandidateGenerator<TAuthRequirement>,
): Promise<TAuthRequirement[]> {
	const collected: TAuthRequirement[] = [];
	for await (const candidate of candidates) {
		collected.push(candidate);
	}
	return collected;
}

function createTestPlannerHost<TBehaviour = Partial<RequirementBehaviour>>(
	behaviour: TBehaviour,
	options: Omit<RequirementPlannerHostOptions<TBehaviour>, "environment"> = {},
): RequirementPlannerHost<TBehaviour> {
	return RequirementPlannerHost.fromBehaviour(behaviour, {
		...options,
		environment: createEnvironmentForTest(),
	});
}

async function prepareAndRunStep(
	planner: StaticRequirementPlanner,
): Promise<Awaited<ReturnType<StaticRequirementPlanner["runStep"]>>> {
	const plan = await planner.buildPlan();
	return planner.runStep(plan);
}

describe("BaseRequirementPlanner pipeline (via StaticRequirementPlanner)", () => {
	it("step 1 checks concurrently without sequential prefix auto-resolve", async () => {
		const seen: string[][] = [];
		const host = createTestPlannerHost({
			checkAuthenticated: (req) => req.id === "b",
			onUnauthenticated: () => false,
			selectCandidate: async (ctx) => {
				const candidates = await collectCandidates(ctx.candidateList);
				seen.push(ids(candidates));
				return candidates[0];
			},
		});
		const planner = StaticRequirementPlanner.fromRequirements(host, [
			StaticAttrsAuthRequirement.create({ id: "a" }),
			StaticAttrsAuthRequirement.create({ id: "b" }),
			StaticAttrsAuthRequirement.create({ id: "c" }),
		] as Readonly<AuthRequirement[]>);

		const plan = await planner.buildPlan();
		const step = await planner.runStep(plan);
		expect(seen).toEqual([["a", "c"]]);
		expect(plan.resolutionList.map((r) => r.requirementId)).toEqual(["b"]);
		expect(step.outcome).toBe("blocked");
		if (step.outcome === "blocked") {
			expect(step.requirement.id).toBe("a");
		}
	});

	it("runs checkAuthenticated concurrently in step 1", async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		const host = createTestPlannerHost({
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
			StaticAttrsAuthRequirement.create({ id: "a" }),
			StaticAttrsAuthRequirement.create({ id: "b" }),
			StaticAttrsAuthRequirement.create({ id: "c" }),
		]);

		const plan = await planner.buildPlan();
		await planner.runStep(plan);
		expect(maxInFlight).toBeGreaterThan(1);
	});

	it("runStep reduces one candidate when the action fulfills it", async () => {
		const host = createTestPlannerHost({
			checkAuthenticated: () => false,
			onUnauthenticated: () => true,
		});
		const planner = StaticRequirementPlanner.fromRequirements(host, [
			StaticAttrsAuthRequirement.create({ id: "a" }),
			StaticAttrsAuthRequirement.create({ id: "b" }),
		]);

		const plan = await planner.buildPlan();
		const step = await planner.runStep(plan);
		expect(step.outcome).toBe("resolved");
		if (step.outcome === "resolved") {
			expect(step.requirement.id).toBe("a");
		}
		expect(plan.resolutionList.map((r) => r.requirementId)).toEqual(["a"]);
		const nextStep = await planner.runStep(plan);
		expect(nextStep.outcome).toBe("resolved");
		if (nextStep.outcome === "resolved") {
			expect(nextStep.requirement.id).toBe("b");
		}
		expect(plan.resolutionList.map((r) => r.requirementId)).toEqual(["a", "b"]);
	});

	it("runUntilSettled runs buildPlan then streams candidates through step 1", async () => {
		const host = createTestPlannerHost({
			checkAuthenticated: () => false,
			onUnauthenticated: () => true,
		});
		const planner = StaticRequirementPlanner.fromRequirements(host, [
			StaticAttrsAuthRequirement.create({ id: "a" }),
			StaticAttrsAuthRequirement.create({ id: "b" }),
			StaticAttrsAuthRequirement.create({ id: "c" }),
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
		const host = createTestPlannerHost({
			checkAuthenticated: () => false,
			onUnauthenticated,
		});
		const planner = StaticRequirementPlanner.fromRequirements(host, [
			StaticAttrsAuthRequirement.create({ id: "a" }),
			StaticAttrsAuthRequirement.create({ id: "b" }),
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
		const host = createTestPlannerHost({
			checkAuthenticated: () => true,
			onUnauthenticated: () => false,
		});
		const planner = StaticRequirementPlanner.fromRequirements(host, [
			StaticAttrsAuthRequirement.create({ id: "a" }),
			StaticAttrsAuthRequirement.create({ id: "b" }),
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
		const host = createTestPlannerHost({
			checkAuthenticated: () => false,
			onUnauthenticated: () => false,
		});
		const planner = StaticRequirementPlanner.fromRequirements(host, []);

		const result = await planner.runUntilSettled();
		expect(result.outcome).toBe("settled");
	});

	it("selectCandidate only sees streamed unsatisfied requirements after step 1", async () => {
		const seen: string[][] = [];
		const host = createTestPlannerHost({
			checkAuthenticated: (req) => req.id === "authed",
			onUnauthenticated: () => false,
			selectCandidate: async (ctx) => {
				const candidates = await collectCandidates(ctx.candidateList);
				seen.push(ids(candidates));
				return candidates[0];
			},
		});
		const planner = StaticRequirementPlanner.fromRequirements(host, [
			StaticAttrsAuthRequirement.create({ id: "authed" }),
			StaticAttrsAuthRequirement.create({ id: "pending" }),
		] as Readonly<AuthRequirement[]>);

		await prepareAndRunStep(planner);
		expect(seen).toEqual([["pending"]]);
	});

	it("binds behaviour once per buildPlan, not per step", async () => {
		let resolveCount = 0;
		const host = {
			resolveEnvironment: async () => createEnvironmentForTest(),
			resolveBehaviourFor: async (
				key: keyof RequirementBehaviour,
				defaultValue: () => unknown,
			) => {
				if (key === "checkAuthenticated") {
					resolveCount += 1;
					return () => true;
				}
				if (key === "onUnauthenticated") {
					return () => false;
				}
				if (key === "selectCandidate") {
					return async (ctx: {
						candidateList: RequirementCandidateGenerator;
					}) => {
						const candidate = await ctx.candidateList.next();
						return candidate.done ? undefined : candidate.value;
					};
				}
				return defaultValue();
			},
		} as unknown as RequirementPlannerHost<Partial<RequirementBehaviour>>;

		const planner = StaticRequirementPlanner.fromRequirements(host, [
			StaticAttrsAuthRequirement.create({ id: "a" }),
			StaticAttrsAuthRequirement.create({ id: "b" }),
		] as Readonly<AuthRequirement[]>);

		const plan = await planner.buildPlan();
		await planner.runStep(plan);
		expect(resolveCount).toBe(1);

		await planner.buildPlan();
		expect(resolveCount).toBe(2);
	});
});
