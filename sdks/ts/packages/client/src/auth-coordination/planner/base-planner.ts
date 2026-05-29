// Base requirement planner — pipeline owner
//
// Canonical public export: @securitydept/client
//
// Pipeline:
//   0. buildPlan() — resolve host behaviour + materialize requirements into a
//      RequirementPlan (fixed for this run until the next buildPlan)
//   1. checkUnauthenticatedCandidates(plan) — concurrent checkAuthenticated
//   2. loop while plan.candidateList is non-empty and no terminal error:
//        2.1 runStep(plan) — selectCandidate, onUnauthenticated
//        2.2 reduce — update plan.candidateList and plan.resolutionList
//
// runStep(plan) is one loop iteration only; it does not run step 1.
// runUntilSettled() calls buildPlan() then runUntilSettledWithPlan(plan).

import {
	type AuthRequirement,
	PipelineOutcome,
	type PipelineRunResult,
	type PipelineStepResult,
	type RequirementBehaviour,
	type RequirementResolution,
	ResolutionStatus,
	type UnauthenticatedAction,
} from "../contract";
import { type RequirementPlannerHost } from "../planner-host";

/**
 * Mutable pipeline state for one run: bound behaviour plus requirement list
 * and evolving candidate / resolution lists.
 */
export interface RequirementPlan extends Readonly<RequirementBehaviour> {
	readonly requirements: readonly AuthRequirement[];
	candidateList: AuthRequirement[];
	resolutionList: RequirementResolution[];
}

/**
 * Abstract base for all requirement planners.
 *
 * Subclasses supply requirements via {@link buildRequirementList}. Pipeline
 * state lives on {@link RequirementPlan}, produced by {@link buildPlan}.
 */
export abstract class BaseRequirementPlanner {
	protected readonly host: RequirementPlannerHost;
	protected initialResolutions: readonly RequirementResolution[];

	protected constructor(
		host: RequirementPlannerHost,
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
	public async buildPlan(): Promise<RequirementPlan> {
		return {
			checkAuthenticated: await this.host.resolveCheckAuthenticated(),
			onUnauthenticated: await this.host.resolveOnUnauthenticated(),
			selectCandidate: await this.host.resolveSelectCandidate(),
			requirements: await this.resolveRequirementList(),
			candidateList: [],
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
		| Map<string, AuthRequirement>
		| Promise<Map<string, AuthRequirement>>;

	/**
	 * Materialize the effective requirement list (also invoked by {@link buildPlan}).
	 */
	public async resolveRequirementList(): Promise<readonly AuthRequirement[]> {
		const requirements = await this.buildRequirementList();
		return [...requirements.values()];
	}
	/**
	 * Pipeline step 1: concurrently evaluate `checkAuthenticated` and refresh
	 * `plan.candidateList` / `plan.resolutionList`.
	 *
	 * Call {@link buildPlan} before the first check. Requirements already
	 * present in `plan.resolutionList` are kept without re-checking.
	 */
	async checkUnauthenticatedCandidates(plan: RequirementPlan): Promise<void> {
		const alreadyResolved = new Map(
			plan.resolutionList.map((resolution) => [
				resolution.requirementId,
				resolution,
			]),
		);

		const evaluated = await Promise.all(
			plan.requirements.map(async (requirement) => {
				const preserved = alreadyResolved.get(requirement.id);
				if (preserved) {
					return { requirement, resolution: preserved };
				}
				const satisfied = await plan.checkAuthenticated(requirement, plan);
				return {
					requirement,
					resolution: satisfied
						? Object.freeze({
								requirementId: requirement.id,
								status: ResolutionStatus.Fulfilled,
							})
						: null,
				};
			}),
		);

		const resolutionList: RequirementResolution[] = [];
		const candidateList: AuthRequirement[] = [];
		for (const { requirement, resolution } of evaluated) {
			if (resolution) {
				resolutionList.push(resolution);
			} else {
				candidateList.push(requirement);
			}
		}

		plan.resolutionList = resolutionList;
		plan.candidateList = candidateList;
	}

	/**
	 * Pipeline step 2 — one loop iteration: select a candidate, run
	 * `onUnauthenticated`, then reduce `plan` state.
	 *
	 * Does not run step 1. Callers must ensure `plan.candidateList` is
	 * non-empty before invoking.
	 */
	async runStep(plan: RequirementPlan): Promise<PipelineStepResult> {
		const candidate = await plan.selectCandidate(plan);
		const action = await plan.onUnauthenticated(candidate, plan);

		return this.reduceFromAction(plan, candidate, action);
	}

	protected reduceFromAction(
		plan: RequirementPlan,
		candidate: AuthRequirement,
		action: Exclude<UnauthenticatedAction, Promise<unknown>>,
	): PipelineStepResult {
		if (action === true) {
			plan.resolutionList = [
				...plan.resolutionList,
				Object.freeze({
					requirementId: candidate.id,
					status: ResolutionStatus.Fulfilled,
				}),
			];
			plan.candidateList = plan.candidateList.filter(
				(requirement) => requirement.id !== candidate.id,
			);
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
	async runUntilSettled(): Promise<PipelineRunResult> {
		const plan = await this.buildPlan();
		return this.runUntilSettledWithPlan(plan);
	}

	async runUntilSettledWithPlan(
		plan: RequirementPlan,
	): Promise<PipelineRunResult> {
		await this.checkUnauthenticatedCandidates(plan);

		if (plan.candidateList.length === 0) {
			return {
				outcome: PipelineOutcome.Settled,
				resolutions: plan.resolutionList,
			};
		}

		while (plan.candidateList.length > 0) {
			const step = await this.runStep(plan);

			if (step.outcome === PipelineOutcome.Resolved) {
				await this.checkUnauthenticatedCandidates(plan);
				continue;
			}
			if (step.outcome === PipelineOutcome.Blocked) {
				return step;
			}
			if (step.outcome === PipelineOutcome.Redirect) {
				return step;
			}
		}

		return {
			outcome: PipelineOutcome.Settled,
			resolutions: plan.resolutionList,
		};
	}
}
