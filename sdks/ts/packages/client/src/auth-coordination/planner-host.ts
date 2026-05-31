// Requirement planner host — non-serializable behaviour resolution
//
// Canonical public export: @securitydept/client
//
// A RequirementPlannerHost carries the runtime, typically non-serializable
// behaviour for a coordination scope: how to check whether a requirement is
// satisfied, how to react when it is not, and how to pick the next candidate
// to act on.
//
// Hosts form a parent chain. A leaf host (e.g. a route scope) resolves each
// behaviour by walking from itself toward the root and using the nearest
// definition. This mirrors hierarchical route/DI scoping without depending on
// any framework. Adapters map their DI containers onto this chain.
//
// Future global, behavioural (usually non-serializable) information can be
// carried here as additional fields without touching the serializable
// contract layer.

import { type FoundationEnvironment } from "../environment";
import {
	type AuthRequirement,
	type RequirementBehaviour,
	type RequirementCandidateSelectionContext,
	type SelectCandidate,
} from "./contract";

/**
 * Default candidate selector: first unauthenticated candidate as soon as it is
 * discovered.
 *
 * If every requirement is already fulfilled the stream completes and the
 * selector returns `undefined`.
 */
export function defaultSelectCandidate<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TPlanContext = {},
>(): SelectCandidate<TAuthRequirement, TPlanContext> {
	return async function selectFirstCandidate(
		context: RequirementCandidateSelectionContext<
			TAuthRequirement,
			TPlanContext
		>,
	): Promise<TAuthRequirement | undefined> {
		const result = await context.candidateList.next();
		return result.done ? undefined : result.value;
	};
}

/** Options for {@link RequirementPlannerHost.fromBehaviour}. */
export interface RequirementPlannerHostOptions<
	TRequirementBehaviour = Partial<RequirementBehaviour>,
> {
	/** Parent host to inherit unspecified behaviour from. */
	parent?: RequirementPlannerHost<TRequirementBehaviour>;
	environment?: FoundationEnvironment;
}

/**
 * A coordination-scope host that resolves behaviour through a parent chain.
 *
 * Construct via {@link RequirementPlannerHost.fromBehaviour}. Each behaviour
 * field is optional at host construction time; missing required behaviour is
 * resolved from `parent` and fails fast during planner build if no host in the
 * chain provides it.
 *
 * @example
 * ```ts
 * const root = RequirementPlannerHost.fromBehaviour({
 *   checkAuthenticated: (req) => isAuthenticated(req),
 *   onUnauthenticated: (req) => `/login/${req.id}`,
 * });
 *
 * // Feature scope overrides only the chooser, inheriting the rest.
 * const feature = RequirementPlannerHost.fromBehaviour(
 *   { selectCandidate: async (ctx) => showChooser(ctx.candidateList) },
 *   { parent: root },
 * );
 * ```
 */
export class RequirementPlannerHost<
	TBehaviour = Partial<RequirementBehaviour>,
> {
	/** The parent host, or undefined at the root. */
	private readonly _behaviour: TBehaviour;

	protected constructor(
		behaviour: TBehaviour,
		readonly environment: FoundationEnvironment | undefined,
		readonly parent: RequirementPlannerHost<TBehaviour> | undefined,
	) {
		this._behaviour = behaviour;
	}

	/** Create a host scope from a partial behaviour and optional parent. */
	static fromBehaviour<TBehaviour = Partial<RequirementBehaviour>>(
		behaviour: TBehaviour,
		options: RequirementPlannerHostOptions<TBehaviour> = {},
	): RequirementPlannerHost<TBehaviour> {
		return new RequirementPlannerHost(
			behaviour,
			options.environment,
			options.parent,
		);
	}

	async resolveBehaviourOptionFor<K extends keyof TBehaviour>(
		key: K,
	): Promise<TBehaviour[K] | undefined> {
		return (
			this._behaviour[key] ??
			(await this.parent?.resolveBehaviourOptionFor(key))
		);
	}
	async resolveBehaviourFor<K extends keyof TBehaviour>(
		key: K,
		defaultValue: () =>
			| NonNullable<TBehaviour[K]>
			| Promise<NonNullable<TBehaviour[K]>>,
	): Promise<NonNullable<TBehaviour[K]>> {
		return (
			(await this.resolveBehaviourOptionFor(key)) ?? (await defaultValue())
		);
	}

	async resolveEnvironmentOption(): Promise<FoundationEnvironment | undefined> {
		return this.environment ?? (await this.parent?.resolveEnvironmentOption());
	}

	async resolveEnvironment(
		defaultValue: () => FoundationEnvironment | Promise<FoundationEnvironment>,
	): Promise<FoundationEnvironment> {
		return (await this.resolveEnvironmentOption()) ?? (await defaultValue());
	}
}
