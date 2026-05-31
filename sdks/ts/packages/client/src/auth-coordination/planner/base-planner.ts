// Base requirement planner — pipeline owner
//
// Canonical public export: @securitydept/client
//
// Pipeline:
//   0. buildPlan() — resolve host behaviour + materialize requirements into a
//      RequirementPlan (fixed for this run until the next buildPlan)
//   1. runStep(plan) — race checkAuthenticated, select the first actionable
//      unauthenticated candidate, then onUnauthenticated
//   2. reduce — update plan.resolutionList
//
// runUntilSettled() calls buildPlan() then runUntilSettledWithPlan(plan).

import { promisesToRacedAsyncGenerator } from "../../compat";
import { type FoundationEnvironment } from "../../environment";
import {
	type AuthRequirement,
	PipelineOutcome,
	type PipelineRunResult,
	type PipelineStepResult,
	type RequirementBehaviour,
	type RequirementCandidateGenerator,
	RequirementPlannerError,
	type RequirementResolution,
	ResolutionStatus,
	type UnauthenticatedAction,
} from "../contract";
import {
	defaultSelectCandidate,
	type RequirementPlannerHost,
} from "../planner-host";

/**
 * Mutable pipeline state for one run: bound behaviour plus requirement list
 * and evolving resolutions.
 */
export interface RequirementPlan<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TPlanContext = {},
> extends Readonly<RequirementBehaviour<TAuthRequirement, TPlanContext>> {
	readonly planContext: TPlanContext;
	readonly environment: FoundationEnvironment;
	readonly requirements: readonly TAuthRequirement[];
	resolutionList: RequirementResolution[];
}

interface RequirementCheckResult<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
> {
	readonly requirement: TAuthRequirement;
	readonly satisfied: boolean;
}

/**
 * Abstract base for all requirement planners.
 *
 * Subclasses supply requirements via {@link buildRequirementList}. Pipeline
 * state lives on {@link RequirementPlan}, produced by {@link buildPlan}.
 */
export abstract class BaseRequirementPlanner<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TPlanContext = {},
	TBehaviour extends Partial<
		RequirementBehaviour<TAuthRequirement, TPlanContext>
	> = Partial<RequirementBehaviour<TAuthRequirement, TPlanContext>>,
> {
	protected readonly host: RequirementPlannerHost<TBehaviour>;
	protected initialResolutions: readonly RequirementResolution[];

	abstract get planContext(): TPlanContext;

	protected constructor(
		host: RequirementPlannerHost<TBehaviour>,
		initialResolutions: readonly RequirementResolution[] = [],
	) {
		this.host = host;
		this.initialResolutions = initialResolutions.map((resolution) =>
			Object.freeze({ ...resolution }),
		);
	}

	// --- Pipeline step 0 -----------------------------------------------------

	/**
	 * Pipeline step 0: resolve host behaviour and materialize requirements into
	 * a {@link RequirementPlan}.
	 *
	 * Behaviour and the requirement list stay fixed on the returned plan until
	 * the next `buildPlan()` call. Resolve host parent chains (and any
	 * injection-context capture) here — not between async steps.
	 */
	public async buildPlan(): Promise<
		RequirementPlan<TAuthRequirement, TPlanContext>
	> {
		return {
			planContext: this.planContext,
			environment: await this.host.resolveEnvironment(() => {
				throw new RequirementPlannerError("No environment resolved");
			}),
			checkAuthenticated: await this.host.resolveBehaviourFor(
				"checkAuthenticated",
				() => {
					throw new RequirementPlannerError("No checkAuthenticated resolved");
				},
			),
			onUnauthenticated: await this.host.resolveBehaviourFor(
				"onUnauthenticated",
				() => {
					throw new RequirementPlannerError(
						"No onUnauthenticated behaviour resolved",
					);
				},
			),
			selectCandidate: await this.host.resolveBehaviourFor(
				"selectCandidate",
				defaultSelectCandidate<TAuthRequirement, TPlanContext>,
			),
			requirements: await this.resolveRequirementList(),
			resolutionList: [...this.initialResolutions],
		};
	}

	// --- Pipeline step 1 -----------------------------------------------------

	/**
	 * Return the effective requirement map for this planner.
	 *
	 * Keys are requirement ids; {@link Map} insertion order defines evaluation
	 * order. Subclasses own deduplication policy when folding multiple sources.
	 */
	protected abstract buildRequirementList():
		| Map<string, TAuthRequirement>
		| Promise<Map<string, TAuthRequirement>>;

	/**
	 * Materialize the effective requirement list (also invoked by {@link buildPlan}).
	 */
	public async resolveRequirementList(): Promise<readonly TAuthRequirement[]> {
		const requirements = await this.buildRequirementList();
		return [...requirements.values()];
	}
	/**
	 * Pipeline step 1 — one loop iteration: select a candidate, run
	 * `onUnauthenticated`, then reduce `plan` state.
	 */
	async runStep(
		plan: RequirementPlan<TAuthRequirement, TPlanContext>,
	): Promise<PipelineStepResult<TAuthRequirement>> {
		const candidate = await plan.selectCandidate({
			...plan,
			candidateList: this.createCandidateStream(plan),
		});
		if (!candidate) {
			return { outcome: PipelineOutcome.Settled };
		}
		const action = await plan.onUnauthenticated(candidate, plan);

		return this.reduceFromAction(plan, candidate, action);
	}

	protected reduceFromAction(
		plan: RequirementPlan<TAuthRequirement, TPlanContext>,
		candidate: TAuthRequirement,
		action: Exclude<UnauthenticatedAction, Promise<unknown>>,
	): PipelineStepResult<TAuthRequirement> {
		if (action === true) {
			this.recordFulfilled(plan, candidate);
			return { outcome: PipelineOutcome.Resolved, requirement: candidate };
		}
		if (action === false) {
			return { outcome: PipelineOutcome.Blocked, requirement: candidate };
		}
		return {
			outcome: PipelineOutcome.Redirect,
			requirement: candidate,
			location: action,
		};
	}

	// --- Pipeline orchestration ---------------------------------------------

	/**
	 * Run the full pipeline: {@link buildPlan}, step 1, then loop step 2 until
	 * settled or a terminal outcome (`blocked`, `redirect`, or a never-settling
	 * action).
	 */
	async runUntilSettled(): Promise<PipelineRunResult<TAuthRequirement>> {
		const plan = await this.buildPlan();
		return this.runUntilSettledWithPlan(plan);
	}

	async runUntilSettledWithPlan(
		plan: RequirementPlan<TAuthRequirement, TPlanContext>,
	): Promise<PipelineRunResult<TAuthRequirement>> {
		while (true) {
			const step = await this.runStep(plan);

			if (step.outcome === PipelineOutcome.Settled) {
				return {
					outcome: PipelineOutcome.Settled,
					resolutions: plan.resolutionList,
				};
			}
			if (step.outcome === PipelineOutcome.Resolved) {
				continue;
			}
			if (step.outcome === PipelineOutcome.Blocked) {
				return step;
			}
			if (step.outcome === PipelineOutcome.Redirect) {
				return step;
			}
		}
	}

	private async *createCandidateStream(
		plan: RequirementPlan<TAuthRequirement, TPlanContext>,
	): RequirementCandidateGenerator<TAuthRequirement> {
		const context = {
			planContext: this.planContext,
			requirements: plan.requirements,
			resolutionList: plan.resolutionList,
			environment: plan.environment,
		};
		const checked = plan.requirements
			.filter(
				(requirement) =>
					!plan.resolutionList.some(
						(resolution) => resolution.requirementId === requirement.id,
					),
			)
			.map(
				async (
					requirement,
				): Promise<RequirementCheckResult<TAuthRequirement>> => {
					const satisfied = await plan.checkAuthenticated(requirement, context);
					return { requirement, satisfied };
				},
			);

		for await (const {
			requirement,
			satisfied,
		} of promisesToRacedAsyncGenerator(checked)) {
			if (satisfied) {
				this.recordFulfilled(plan, requirement);
				continue;
			}
			yield requirement;
		}
	}

	private recordFulfilled(
		plan: RequirementPlan<TAuthRequirement, TPlanContext>,
		requirement: TAuthRequirement,
	): void {
		if (
			plan.resolutionList.some(
				(resolution) => resolution.requirementId === requirement.id,
			)
		) {
			return;
		}
		plan.resolutionList.push(
			Object.freeze({
				requirementId: requirement.id,
				status: ResolutionStatus.Fulfilled,
			}),
		);
	}
}
