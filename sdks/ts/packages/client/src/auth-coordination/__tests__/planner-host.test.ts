import { describe, expect, it } from "vitest";
import { createEnvironmentForTest } from "../../test";
import {
	type AuthRequirement,
	type RequirementBehaviour,
	type RequirementCandidateGenerator,
	RequirementPlannerHost,
	type RequirementPlannerHostOptions,
	StaticAttrsAuthRequirement,
	StaticRequirementPlanner,
} from "../index";

async function collectCandidates(
	candidates: RequirementCandidateGenerator,
): Promise<AuthRequirement[]> {
	const collected: AuthRequirement[] = [];
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

describe("RequirementPlannerHost behaviour resolution", () => {
	it("fails fast when required behaviour is missing", async () => {
		const host = createTestPlannerHost({});
		const planner = StaticRequirementPlanner.fromRequirements(host, [
			StaticAttrsAuthRequirement.create({ id: "a" }),
		]);

		await expect(planner.runUntilSettled()).rejects.toThrow(
			/No checkAuthenticated resolved/,
		);
	});

	it("default selectCandidate picks the first candidate", async () => {
		const host = createTestPlannerHost({
			checkAuthenticated: () => false,
			onUnauthenticated: () => false,
		});
		const planner = StaticRequirementPlanner.fromRequirements(host, [
			StaticAttrsAuthRequirement.create({ id: "first" }),
			StaticAttrsAuthRequirement.create({ id: "second" }),
		]);

		const plan = await planner.buildPlan();
		const step = await planner.runStep(plan);
		expect(step.outcome).toBe("blocked");
		if (step.outcome === "blocked") {
			expect(step.requirement.id).toBe("first");
		}
	});
});

describe("RequirementPlannerHost parent chain", () => {
	it("inherits checkAuthenticated/onUnauthenticated, overrides selectCandidate", async () => {
		const root = createTestPlannerHost({
			checkAuthenticated: () => false,
			onUnauthenticated: () => "/login",
		});
		const child = createTestPlannerHost<Partial<RequirementBehaviour>>(
			{
				selectCandidate: async (ctx): Promise<AuthRequirement | undefined> => {
					const candidates = await collectCandidates(ctx.candidateList);
					return candidates.at(-1);
				},
			},
			{ parent: root },
		);

		const planner = StaticRequirementPlanner.fromRequirements(child, [
			StaticAttrsAuthRequirement.create({ id: "a" }),
			StaticAttrsAuthRequirement.create({ id: "b" }),
		] as Readonly<AuthRequirement[]>);

		const plan = await planner.buildPlan();
		const step = await planner.runStep(plan);
		// inherited onUnauthenticated -> redirect; overridden chooser -> last
		expect(step.outcome).toBe("redirect");
		if (step.outcome === "redirect") {
			expect(step.requirement.id).toBe("b");
			expect(step.location).toBe("/login");
		}
	});

	it("falls through multiple levels to the nearest definition", async () => {
		const root = createTestPlannerHost<Partial<RequirementBehaviour>>({
			onUnauthenticated: () => "/root",
		});
		const mid = createTestPlannerHost<Partial<RequirementBehaviour>>(
			{},
			{ parent: root },
		);
		const leaf = createTestPlannerHost<Partial<RequirementBehaviour>>(
			{},
			{ parent: mid },
		);

		const resolved = await leaf.resolveBehaviourFor(
			"onUnauthenticated",
			() => () => false,
		);
		expect(
			resolved(StaticAttrsAuthRequirement.create({ id: "x" }), {
				planContext: {},
				environment: createEnvironmentForTest(),
				requirements: [],
				resolutionList: [],
			}),
		).toBe("/root");
	});
});
