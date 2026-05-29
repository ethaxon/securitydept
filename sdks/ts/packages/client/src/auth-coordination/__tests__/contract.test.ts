import { describe, expect, it } from "vitest";
import {
	createAuthRequirement,
	createAuthRequirements,
	PlanStatus,
	RequirementsComposition,
	ResolutionStatus,
	resolveEffectiveRequirements,
} from "../index";

describe("createAuthRequirement", () => {
	it("assigns a uuidv7 id when omitted", () => {
		const requirement = createAuthRequirement();
		expect(requirement.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
		);
	});

	it("preserves an explicit id and freezes the requirement", () => {
		const attributes = { clientKey: "wiki" };
		const requirement = createAuthRequirement({ id: "wiki", attributes });

		expect(requirement.id).toBe("wiki");
		expect(Object.isFrozen(requirement)).toBe(true);
		expect(Object.isFrozen(requirement.attributes)).toBe(true);
		attributes.clientKey = "mutated";
		expect(requirement.attributes?.clientKey).toBe("wiki");
	});

	it("creates multiple requirements in declaration order", () => {
		const requirements = createAuthRequirements([{ id: "a" }, { id: "b" }]);
		expect(requirements.map((r) => r.id)).toEqual(["a", "b"]);
	});
});

describe("resolveEffectiveRequirements", () => {
	const parent = new Map(
		[
			createAuthRequirement({ id: "session" }),
			createAuthRequirement({ id: "api" }),
		].map((requirement) => [requirement.id, requirement]),
	);

	it("inherit keeps the effective map unchanged", () => {
		const effective = new Map(parent);
		resolveEffectiveRequirements(
			{
				composition: RequirementsComposition.Inherit,
				requirements: [createAuthRequirement({ id: "ignored" })],
			},
			effective,
		);
		expect([...effective.values()].map((r) => r.id)).toEqual([
			"session",
			"api",
		]);
	});

	it("merge appends and overrides by id", () => {
		const effective = new Map(parent);
		resolveEffectiveRequirements(
			{
				composition: RequirementsComposition.Merge,
				requirements: [
					createAuthRequirement({ id: "api", label: "overridden" }),
					createAuthRequirement({ id: "oidc" }),
				],
			},
			effective,
		);
		expect([...effective.values()].map((r) => r.id)).toEqual([
			"session",
			"api",
			"oidc",
		]);
		expect([...effective.values()].find((r) => r.id === "api")?.label).toBe(
			"overridden",
		);
	});

	it("replace discards the previous effective map", () => {
		const effective = new Map(parent);
		resolveEffectiveRequirements(
			{
				composition: RequirementsComposition.Replace,
				requirements: [createAuthRequirement({ id: "public" })],
			},
			effective,
		);
		expect([...effective.values()].map((r) => r.id)).toEqual(["public"]);
	});

	it("replace with an empty set yields a public zone", () => {
		const effective = new Map(parent);
		resolveEffectiveRequirements(
			{
				composition: RequirementsComposition.Replace,
				requirements: [],
			},
			effective,
		);
		expect([...effective.values()]).toEqual([]);
	});

	it("defaults to a fresh map when effective is omitted", () => {
		const effective = resolveEffectiveRequirements({
			composition: RequirementsComposition.Merge,
			requirements: [createAuthRequirement({ id: "session" })],
		});
		expect([...effective.values()].map((r) => r.id)).toEqual(["session"]);
	});
});

describe("constant value domains", () => {
	it("ResolutionStatus values are stable", () => {
		expect(ResolutionStatus.Fulfilled).toBe("fulfilled");
		expect(ResolutionStatus.Failed).toBe("failed");
		expect(ResolutionStatus.Skipped).toBe("skipped");
	});

	it("PlanStatus values are stable", () => {
		expect(PlanStatus.Pending).toBe("pending");
		expect(PlanStatus.Settled).toBe("settled");
	});
});
