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

import {
	type AuthRequirement,
	type CheckAuthenticated,
	type OnUnauthenticated,
	type RequirementBehaviour,
	type RequirementBehaviourContext,
	type SelectCandidate,
} from "./contract";

/**
 * Default check: treat every requirement as unauthenticated.
 *
 * Safe default — without an explicit policy nothing is considered satisfied,
 * so every requirement becomes an actionable candidate.
 */
const defaultCheckAuthenticated: CheckAuthenticated = () => false;

/**
 * Default unauthenticated handler: block.
 *
 * Safe default — without an explicit policy a pending requirement halts the
 * plan rather than silently allowing it.
 */
const defaultOnUnauthenticated: OnUnauthenticated = () => false;

/**
 * Default candidate selector: first candidate in declaration order.
 *
 * Only invoked when the candidate list is non-empty, so the indexed read is
 * always defined at the call site.
 */
const defaultSelectCandidate: SelectCandidate = (
	context: RequirementBehaviourContext,
): AuthRequirement => context.candidateList[0];

/** Options for {@link RequirementPlannerHost.fromBehaviour}. */
export interface RequirementPlannerHostOptions {
	/** Parent host to inherit unspecified behaviour from. */
	parent?: RequirementPlannerHost;
}

/**
 * A coordination-scope host that resolves behaviour through a parent chain.
 *
 * Construct via {@link RequirementPlannerHost.fromBehaviour}. Each behaviour
 * field is optional; unspecified fields are inherited from `parent`, falling
 * back to safe defaults at the root.
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
export class RequirementPlannerHost {
	/** The parent host, or undefined at the root. */
	readonly parent?: RequirementPlannerHost;

	private readonly _checkAuthenticated?: CheckAuthenticated;
	private readonly _onUnauthenticated?: OnUnauthenticated;
	private readonly _selectCandidate?: SelectCandidate;

	protected constructor(
		behaviour: Partial<RequirementBehaviour>,
		parent?: RequirementPlannerHost,
	) {
		this._checkAuthenticated = behaviour.checkAuthenticated;
		this._onUnauthenticated = behaviour.onUnauthenticated;
		this._selectCandidate = behaviour.selectCandidate;
		this.parent = parent;
	}

	/** Create a host scope from a partial behaviour and optional parent. */
	static fromBehaviour(
		behaviour: Partial<RequirementBehaviour>,
		options: RequirementPlannerHostOptions = {},
	): RequirementPlannerHost {
		return new RequirementPlannerHost(behaviour, options.parent);
	}

	/** Resolve the nearest `checkAuthenticated`, defaulting to "unauthenticated". */
	async resolveCheckAuthenticated(): Promise<CheckAuthenticated> {
		return (
			this._checkAuthenticated ??
			(await this.parent?.resolveCheckAuthenticated()) ??
			defaultCheckAuthenticated
		);
	}

	/** Resolve the nearest `onUnauthenticated`, defaulting to "block". */
	async resolveOnUnauthenticated(): Promise<OnUnauthenticated> {
		return (
			this._onUnauthenticated ??
			(await this.parent?.resolveOnUnauthenticated()) ??
			defaultOnUnauthenticated
		);
	}

	/** Resolve the nearest `selectCandidate`, defaulting to first-in-order. */
	async resolveSelectCandidate(): Promise<SelectCandidate> {
		return (
			this._selectCandidate ??
			(await this.parent?.resolveSelectCandidate()) ??
			defaultSelectCandidate
		);
	}
}
