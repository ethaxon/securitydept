// TanStack React Router route-security contract for auth-coordination
//
// Canonical import path:
//   import { ... } from "@securitydept/client-react/tanstack-router"
//
// Provides the complete route-security contract for TanStack React Router,
// aligned with the Angular Router contract in @securitydept/client-angular:
//
// Adopter-facing canonical path (highest level):
//   - createSecureBeforeLoad()   — root-level beforeLoad factory that wires
//     non-serializable runtime policy (handlers, redirect logic) into
//     TanStack Router's execution semantics. This is the TanStack equivalent
//     of Angular's secureRouteRoot().
//   - withTanStackRouteRequirements() — child-route serializable metadata
//     declaration. This is the TanStack equivalent of Angular's secureRoute().
//
// Lower-level building blocks:
//   - extractTanStackRouteRequirements() — full-route aggregation with
//     merge/replace/inherit composition
//   - createTanStackRouteSecurityPolicy() — headless evaluator (no router
//     execution glue; for custom integrations)
//   - projectTanStackRouteMatches() / createTanStackRouteActivator() —
//     RouteRequirementOrchestrator projection helpers
//
// Architecture boundary:
//   - Does NOT own the router, lifecycle, or render UI.
//   - Does NOT re-export core orchestration primitives.
//   - Does NOT carry token-set-specific mapping, policy, or registry logic.
//   - The adopter wires this into their router setup.
//
// Relationship to Angular sibling:
//   - createSecureBeforeLoad()              ↔  secureRouteRoot()
//   - withTanStackRouteRequirements()       ↔  secureRoute() / withRouteRequirements()
//   - extractTanStackRouteRequirements()    ↔  extractFullRouteRequirements()
//   - createTanStackRouteSecurityPolicy()   ↔  createTokenSetRouteAggregationGuard()
//   - Both share RequirementsClientSetComposition from @securitydept/client/auth-coordination
//
// Stability: provisional

import type {
	AuthRequirement,
	RouteMatchNode,
} from "@securitydept/client/auth-coordination";
import { RequirementsClientSetComposition } from "@securitydept/client/auth-coordination";
import type { AnyRoute, RegisteredRouter } from "@tanstack/react-router";

export type { AuthRequirement, RouteMatchNode };

// ---------------------------------------------------------------------------
// Route match shape
// ---------------------------------------------------------------------------

/**
 * Minimal shape of a TanStack Router route match entry.
 *
 * Structurally compatible with the matches returned by `useMatches()`.
 * The adapter reads `staticData` (set via `beforeLoad` or `staticData` option)
 * to find auth requirements.
 */
export interface TanStackRouteMatch {
	/** Route identifier (the route's `id` field). */
	routeId: string;
	/**
	 * Static route context, typically set via `beforeLoad` or `staticData`.
	 * Auth requirements should be declared here under a well-known key.
	 *
	 * Typed as `object` (not `Record<string, unknown>`) to remain structurally
	 * compatible with TanStack Router's open `StaticDataRouteOption` interface,
	 * which does not carry an index signature.
	 */
	staticData?: object;
	/** Route context merged from parent. */
	context?: object;
	/** Route loader data, if available. */
	loaderData?: object;
}

// ---------------------------------------------------------------------------
// Route data keys
// ---------------------------------------------------------------------------

/** Default key for auth requirements in TanStack Router `staticData`. */
export const DEFAULT_REQUIREMENTS_KEY = "authRequirements";

/** Default key for the composition strategy in TanStack Router `staticData`. */
export const DEFAULT_COMPOSITION_KEY = "authRequirementsComposition";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for {@link projectTanStackRouteMatches} and {@link createTanStackRouteActivator}. */
export interface TanStackRouterAdapterOptions {
	/**
	 * Key used to read auth requirements from `staticData`.
	 *
	 * @default "authRequirements"
	 */
	requirementsKey?: string;
}

export interface TanStackRouteLocation {
	pathname: string;
	href: string;
}

/**
 * Runtime context passed to route unauthenticated handlers.
 *
 * `attemptedUrl` is the TanStack Router target URL for the navigation being
 * guarded. Use it as `postAuthRedirectUri` when a handler starts a full-page
 * auth redirect; do not infer this from `window.location`, because the current
 * document URL can still point at the previously committed route.
 */
export interface TanStackRouteUnauthenticatedContext {
	readonly location: TanStackRouteLocation;
	readonly attemptedUrl: string;
	readonly matches: readonly TanStackRouteMatch[];
	readonly cause: string | undefined;
}

export type TanStackRouteUnauthenticatedAction = boolean | string;

export type TanStackRouteUnauthenticatedHandler = (
	requirement: AuthRequirement,
	context: TanStackRouteUnauthenticatedContext,
) =>
	| TanStackRouteUnauthenticatedAction
	| Promise<TanStackRouteUnauthenticatedAction>;

// ---------------------------------------------------------------------------
// Route metadata declaration helper
// ---------------------------------------------------------------------------

/**
 * Options for {@link withTanStackRouteRequirements}.
 */
export interface WithTanStackRouteRequirementsOptions {
	/**
	 * How this route segment composes with its parent route chain.
	 * @default RequirementsClientSetComposition.Merge
	 */
	composition?: RequirementsClientSetComposition;

	/**
	 * Additional staticData properties to merge into the returned object.
	 */
	extra?: Record<string, unknown>;
}

/**
 * Build a TanStack Router `staticData` object declaring auth requirements for
 * a single route segment.
 *
 * This is the TanStack Router equivalent of Angular's `withRouteRequirements()`.
 *
 * @example
 * ```ts
 * import { createRoute } from "@tanstack/react-router";
 * import { withTanStackRouteRequirements } from "@securitydept/client-react/tanstack-router";
 *
 * const dashboardRoute = createRoute({
 *   getParentRoute: () => rootRoute,
 *   path: "dashboard",
 *   staticData: withTanStackRouteRequirements([
 *     { id: "session", kind: "session" },
 *   ]),
 * });
 *
 * // Child route replaces parent requirements:
 * const publicRoute = createRoute({
 *   getParentRoute: () => dashboardRoute,
 *   path: "public",
 *   staticData: withTanStackRouteRequirements([], {
 *     composition: RequirementsClientSetComposition.Replace,
 *   }),
 * });
 * ```
 *
 * @param requirements - Auth requirements for this route segment.
 * @param options - Optional composition strategy and extra staticData.
 */
export function withTanStackRouteRequirements(
	requirements: AuthRequirement[],
	options?: WithTanStackRouteRequirementsOptions,
): Record<string, unknown> {
	return {
		...(options?.extra ?? {}),
		[DEFAULT_REQUIREMENTS_KEY]: requirements,
		[DEFAULT_COMPOSITION_KEY]:
			options?.composition ?? RequirementsClientSetComposition.Merge,
	};
}

// ---------------------------------------------------------------------------
// Full-route aggregation with composition semantics
// ---------------------------------------------------------------------------

/**
 * Extract and compose auth requirements from a TanStack Router matched route
 * chain, respecting merge/replace/inherit composition at each segment.
 *
 * This is the TanStack Router equivalent of Angular's
 * `extractFullRouteRequirements()`. It walks the matched route chain from root
 * to leaf and applies the composition strategy declared at each segment:
 *
 * - `inherit` — keep parent requirements unchanged
 * - `merge` — append child requirements, replacing same-id parent entries
 * - `replace` — discard parent chain, use only child's requirements
 *
 * @param matches - Matched route chain from root to leaf (as from `useMatches()`).
 * @param options - Optional key override.
 */
export function extractTanStackRouteRequirements(
	matches: readonly TanStackRouteMatch[],
	options?: TanStackRouterAdapterOptions,
): AuthRequirement[] {
	const key = options?.requirementsKey ?? DEFAULT_REQUIREMENTS_KEY;
	let result: AuthRequirement[] = [];

	for (const match of matches) {
		const raw = (match.staticData as Record<string, unknown>)?.[key];
		const compositionRaw = (match.staticData as Record<string, unknown>)?.[
			DEFAULT_COMPOSITION_KEY
		];
		const composition = isValidComposition(compositionRaw)
			? compositionRaw
			: RequirementsClientSetComposition.Merge;
		const requirements: AuthRequirement[] = Array.isArray(raw) ? raw : [];

		result = resolveEffectiveRequirements(result, {
			composition,
			requirements,
		});
	}
	return result;
}

// ---------------------------------------------------------------------------
// Composition resolution (shared logic with Angular sibling)
// ---------------------------------------------------------------------------

/**
 * Route-level auth requirement declaration for composition resolution.
 */
export interface RouteRequirementsDeclaration {
	requirements: readonly AuthRequirement[];
	composition: RequirementsClientSetComposition;
}

/**
 * Resolve the effective auth requirements by composing the parent chain with a
 * child route declaration.
 *
 * Composition semantics mirror Angular's `resolveEffectiveRequirements()`:
 * - `inherit` keeps the parent requirements unchanged
 * - `merge` appends child requirements and replaces same-id parent entries
 * - `replace` discards the parent chain and uses only the child's requirements
 */
export function resolveEffectiveRequirements(
	parentRequirements: readonly AuthRequirement[],
	child: RouteRequirementsDeclaration,
): AuthRequirement[] {
	switch (child.composition) {
		case RequirementsClientSetComposition.Inherit:
			return [...parentRequirements];

		case RequirementsClientSetComposition.Merge: {
			const merged = new Map<string, AuthRequirement>();
			for (const requirement of parentRequirements) {
				merged.set(requirement.id, requirement);
			}
			for (const requirement of child.requirements) {
				merged.set(requirement.id, requirement);
			}
			return [...merged.values()];
		}

		case RequirementsClientSetComposition.Replace:
			return [...child.requirements];

		default: {
			const _exhaustive: never = child.composition;
			throw new Error(
				`[resolveEffectiveRequirements] Unknown composition: ${_exhaustive}`,
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Projection (lower-level — preserved for backward compatibility)
// ---------------------------------------------------------------------------

/**
 * Project TanStack Router matched route entries into the SDK's
 * `RouteMatchNode[]` contract.
 *
 * Each match entry is mapped to a `RouteMatchNode`:
 *   - `routeId` is taken from `match.routeId`
 *   - `requirements` is read from `match.staticData[requirementsKey]`
 *
 * Entries with no requirements produce nodes with an empty requirements array,
 * preserving the full chain for shared-prefix diffing.
 *
 * @example
 * ```ts
 * import { useMatches } from "@tanstack/react-router";
 * import { projectTanStackRouteMatches } from "@securitydept/client-react/tanstack-router";
 *
 * const matches = useMatches();
 * const routeChain = projectTanStackRouteMatches(matches);
 * orchestrator.activateMatchedRoutes(routeChain);
 * ```
 */
export function projectTanStackRouteMatches(
	matches: readonly TanStackRouteMatch[],
	options?: TanStackRouterAdapterOptions,
): RouteMatchNode[] {
	const key = options?.requirementsKey ?? DEFAULT_REQUIREMENTS_KEY;
	return matches.map((match) => {
		const rawRequirements = (match.staticData as Record<string, unknown>)?.[
			key
		];
		const requirements: AuthRequirement[] = Array.isArray(rawRequirements)
			? rawRequirements
			: [];
		return {
			routeId: match.routeId,
			requirements,
		};
	});
}

// ---------------------------------------------------------------------------
// Activator factory (lower-level — preserved for backward compatibility)
// ---------------------------------------------------------------------------

/**
 * Create a route-change activator that projects TanStack Router matches and
 * activates them on the orchestrator.
 *
 * This is framework-agnostic (not a React hook) and can be called from a
 * `useEffect`, route subscriber, or any mechanism that notifies match changes.
 *
 * @example
 * ```ts
 * import { useMatches } from "@@tanstack/react-router";
 * import { createTanStackRouteActivator } from "@securitydept/client-react/tanstack-router";
 *
 * const activator = createTanStackRouteActivator(orchestrator);
 *
 * function RouteOrchestrationBridge() {
 *   const matches = useMatches();
 *   useEffect(() => activator.activate(matches), [matches]);
 *   return null;
 * }
 * ```
 */
export function createTanStackRouteActivator(
	orchestrator: {
		activateMatchedRoutes(chain: readonly RouteMatchNode[]): void;
		deactivateRoute(): void;
	},
	options?: TanStackRouterAdapterOptions,
) {
	return {
		/** Project matches and activate the route chain on the orchestrator. */
		activate(matches: readonly TanStackRouteMatch[]): void {
			const chain = projectTanStackRouteMatches(matches, options);
			orchestrator.activateMatchedRoutes(chain);
		},
		/** Deactivate the current route (e.g. on unmount or navigation away). */
		deactivate(): void {
			orchestrator.deactivateRoute();
		},
	};
}

// ---------------------------------------------------------------------------
// Root-level route security runtime policy
// ---------------------------------------------------------------------------

/**
 * Root-level runtime policy for a secured TanStack Router route tree.
 *
 * This is the TanStack Router equivalent of Angular's
 * `SecureRouteRootSecurityOptions`. Non-serializable runtime callbacks
 * (planner host, onUnauthenticated handlers) live here, NOT in individual
 * route `staticData`.
 *
 * @example
 * ```ts
 * const routeSecurityPolicy = createTanStackRouteSecurityPolicy({
 *   requirementHandlers: {
 *     frontend_oidc: (failingRequirement) => {
 *       redirectToLogin(failingRequirement);
 *       return false;
 *     },
 *   },
 * });
 *
 * // Use in beforeLoad:
 * const protectedRoute = createRoute({
 *   beforeLoad: ({ matches }) => {
 *     routeSecurityPolicy.enforce(matches);
 *   },
 * });
 * ```
 */
export interface TanStackRouteSecurityPolicyOptions {
	/**
	 * Per-requirement-kind handlers.
	 * Keys are `AuthRequirement.kind` strings.
	 */
	requirementHandlers?: Record<string, TanStackRouteUnauthenticatedHandler>;

	/**
	 * Fallback handler when no kind-specific handler matches.
	 */
	defaultOnUnauthenticated?: TanStackRouteUnauthenticatedHandler;

	/**
	 * Custom key for reading requirements from staticData.
	 * @default "authRequirements"
	 */
	requirementsKey?: string;
}

/**
 * Route security evaluation result from
 * {@link createTanStackRouteSecurityPolicy}.
 */
export interface TanStackRouteSecurityResult {
	/** All requirements are met — allow navigation. */
	readonly allMet: boolean;
	/** The first unmet requirement, if any. */
	readonly pendingRequirement: AuthRequirement | undefined;
	/** Handler action for the pending requirement (from policy). */
	readonly action:
		| TanStackRouteUnauthenticatedAction
		| Promise<TanStackRouteUnauthenticatedAction>
		| undefined;
	/** The full effective requirements after composition. */
	readonly effectiveRequirements: readonly AuthRequirement[];
}

/**
 * Create a root-level route security policy that evaluates a TanStack Router
 * matched route chain and returns the enforcement decision.
 *
 * This is the TanStack Router equivalent of Angular's `secureRouteRoot()`.
 * It centralizes non-serializable runtime policy (handlers, redirects) at
 * the root level, while individual routes only declare serializable metadata
 * via `withTanStackRouteRequirements()`.
 *
 * The returned `evaluate()` function:
 * 1. Extracts requirements from the matched route chain (with composition)
 * 2. Finds the first unmet requirement using the provided `checkAuthenticated`
 * 3. Resolves the handler action (kind handler → default handler → block)
 *
 * @example
 * ```ts
 * import { createTanStackRouteSecurityPolicy } from "@securitydept/client-react/tanstack-router";
 *
 * const policy = createTanStackRouteSecurityPolicy({
 *   requirementHandlers: {
 *     frontend_oidc: (req) => {
 *       redirectToOidcLogin(req);
 *       return false;
 *     },
 *   },
 *   defaultOnUnauthenticated: () => "/login",
 * });
 *
 * // In a route's beforeLoad or a React effect:
 * const result = policy.evaluate(matches, (req) => isAuthenticated(req.kind));
 * if (!result.allMet && typeof result.action === "string") {
 *   navigate({ to: result.action });
 * }
 * ```
 */
export function createTanStackRouteSecurityPolicy(
	options: TanStackRouteSecurityPolicyOptions = {},
) {
	return {
		/**
		 * Evaluate the route security policy for a matched route chain.
		 *
		 * @param matches - The matched route chain (root → leaf).
		 * @param checkAuthenticated - Returns true if a requirement is met.
		 */
		evaluate(
			matches: readonly TanStackRouteMatch[],
			checkAuthenticated: (requirement: AuthRequirement) => boolean,
			context?: TanStackRouteUnauthenticatedContext,
		): TanStackRouteSecurityResult {
			const effectiveRequirements = extractTanStackRouteRequirements(matches, {
				requirementsKey: options.requirementsKey,
			});
			const handlerContext =
				context ?? createFallbackUnauthenticatedContext(matches);

			for (const req of effectiveRequirements) {
				if (!checkAuthenticated(req)) {
					const handler =
						options.requirementHandlers?.[req.kind] ??
						options.defaultOnUnauthenticated;

					return {
						allMet: false,
						pendingRequirement: req,
						action: handler ? handler(req, handlerContext) : false,
						effectiveRequirements,
					};
				}
			}

			return {
				allMet: true,
				pendingRequirement: undefined,
				action: undefined,
				effectiveRequirements,
			};
		},
	};
}

// ---------------------------------------------------------------------------
// Route-security beforeLoad factory — canonical adopter-facing entry
// ---------------------------------------------------------------------------

/**
 * Navigation-blocked error thrown by {@link createSecureBeforeLoad} when a
 * requirement is unmet and the handler returns `false`.
 */
export class RouteSecurityBlockedError extends Error {
	constructor(
		public readonly requirement: AuthRequirement,
		public readonly result: TanStackRouteSecurityResult,
	) {
		super(
			`[secureBeforeLoad] Navigation blocked: requirement "${requirement.id}" (kind: ${requirement.kind}) is not authenticated.`,
		);
		this.name = "RouteSecurityBlockedError";
	}
}

/**
 * Minimal shape of TanStack Router's `beforeLoad` context.
 *
 * Only the fields actually consumed by {@link createSecureBeforeLoad} are
 * required. The full TanStack Router context has many more fields; this
 * interface lets the helper stay structurally compatible without importing
 * the full framework type.
 */
export interface SecureBeforeLoadContext {
	/** URL location of the target route. */
	location: TanStackRouteLocation;
	/**
	 * Matched route entries for the current navigation.
	 * Shape matches {@link TanStackRouteMatch}.
	 */
	matches: readonly TanStackRouteMatch[];
	/** Navigation cause ("enter", "stay", "push", "replace", etc.). */
	cause: string;
}

/**
 * Options for {@link createSecureBeforeLoad}.
 */
export interface CreateSecureBeforeLoadOptions
	extends TanStackRouteSecurityPolicyOptions {
	/**
	 * Returns true if the given auth requirement is currently satisfied.
	 *
	 * This is the auth-state bridge: the adopter supplies a function that
	 * checks their auth store / context.
	 */
	checkAuthenticated: (requirement: AuthRequirement) => boolean;

	/**
	 * TanStack Router's `redirect()` function.
	 *
	 * When a handler returns a string (redirect path), `createSecureBeforeLoad`
	 * throws `redirect({ to: path })` to trigger TanStack Router's redirect
	 * mechanism.
	 *
	 * Pass `redirect` from `@tanstack/react-router` here:
	 * ```ts
	 * import { redirect } from "@tanstack/react-router";
	 * createSecureBeforeLoad({ redirect, ... });
	 * ```
	 *
	 * If omitted, string actions cause a {@link RouteSecurityBlockedError}
	 * with the redirect path in the error message.
	 */
	redirect?: (opts: { to: string }) => never;
}

/**
 * Create a `beforeLoad`-compatible function that enforces route-security
 * requirements inside TanStack Router's execution semantics.
 *
 * **This is the canonical TanStack Router adopter-facing entry** — the
 * equivalent of Angular's `secureRouteRoot()`.
 *
 * How it works:
 * 1. Receives TanStack Router's `beforeLoad` context (including `matches`)
 * 2. Extracts the full requirement chain with composition semantics
 * 3. Finds the first unmet requirement
 * 4. Calls the handler (kind handler → default → block)
 * 5. If the handler returns a string path, throws `redirect({ to: path })`
 * 6. If the handler returns `false`, throws {@link RouteSecurityBlockedError}
 * 7. If all requirements are met, returns normally (navigation proceeds)
 *
 * @example
 * ```ts
 * import { redirect, createRoute } from "@tanstack/react-router";
 * import {
 *   createSecureBeforeLoad,
 *   withTanStackRouteRequirements,
 * } from "@securitydept/client-react/tanstack-router";
 *
 * // Root-level: non-serializable runtime policy
 * const securedBeforeLoad = createSecureBeforeLoad({
 *   redirect,
 *   checkAuthenticated: (req) => authStore.isAuthenticated(req.kind),
 *   requirementHandlers: {
 *     frontend_oidc: (req) => "/login/oidc",
 *     session: () => "/login",
 *   },
 * });
 *
 * // Root route — attach the beforeLoad
 * const rootRoute = createRootRoute({
 *   beforeLoad: securedBeforeLoad,
 * });
 *
 * // Child routes — serializable declaration only
 * const dashboardRoute = createRoute({
 *   getParentRoute: () => rootRoute,
 *   path: "dashboard",
 *   staticData: withTanStackRouteRequirements([
 *     { id: "session", kind: "session" },
 *   ]),
 * });
 *
 * const adminRoute = createRoute({
 *   getParentRoute: () => dashboardRoute,
 *   path: "admin",
 *   staticData: withTanStackRouteRequirements([
 *     { id: "admin-oidc", kind: "frontend_oidc" },
 *   ]),
 * });
 * ```
 */
export function createSecureBeforeLoad(
	options: CreateSecureBeforeLoadOptions,
): (ctx: SecureBeforeLoadContext) => void | Promise<void> {
	const policy = createTanStackRouteSecurityPolicy(options);

	return function secureBeforeLoad(
		ctx: SecureBeforeLoadContext,
	): void | Promise<void> {
		const handlerContext = createUnauthenticatedContext(ctx);
		const result = policy.evaluate(
			ctx.matches,
			options.checkAuthenticated,
			handlerContext,
		);

		if (result.allMet) return;

		const { action, pendingRequirement } = result;

		if (!pendingRequirement) return;

		if (isPromiseLike(action)) {
			return action.then((resolved) =>
				handleSecureBeforeLoadAction(
					resolved,
					pendingRequirement,
					result,
					options,
				),
			);
		}

		return handleSecureBeforeLoadAction(
			action,
			pendingRequirement,
			result,
			options,
		);
	};
}

/**
 * Build a route-security handler for full-page external redirects.
 *
 * The callback should start the browser navigation, typically by calling an
 * auth client's `loginWithRedirect({ postAuthRedirectUri: context.attemptedUrl })`.
 * After that navigation has been started, the returned guard result never
 * settles so TanStack Router does not finalize an in-app blocked navigation
 * while the page is leaving for an external IdP.
 */
export function createExternalRedirectBeforeLoadHandler(
	startRedirect: (
		requirement: AuthRequirement,
		context: TanStackRouteUnauthenticatedContext,
	) => void | Promise<void>,
): TanStackRouteUnauthenticatedHandler {
	return async (requirement, context) => {
		await startRedirect(requirement, context);
		return await neverSettlingBeforeLoadResult();
	};
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function createUnauthenticatedContext(
	ctx: SecureBeforeLoadContext,
): TanStackRouteUnauthenticatedContext {
	return {
		location: ctx.location,
		attemptedUrl: ctx.location.href || ctx.location.pathname,
		matches: ctx.matches,
		cause: ctx.cause,
	};
}

function createFallbackUnauthenticatedContext(
	matches: readonly TanStackRouteMatch[],
): TanStackRouteUnauthenticatedContext {
	return {
		location: { pathname: "", href: "" },
		attemptedUrl: "",
		matches,
		cause: undefined,
	};
}

function handleSecureBeforeLoadAction(
	action: TanStackRouteUnauthenticatedAction | undefined,
	pendingRequirement: AuthRequirement,
	result: TanStackRouteSecurityResult,
	options: CreateSecureBeforeLoadOptions,
): void {
	if (typeof action === "string") {
		if (options.redirect) {
			throw options.redirect({ to: action });
		}
		// No redirect function provided — throw a descriptive error.
		throw new RouteSecurityBlockedError(pendingRequirement, result);
	}

	// action is false or undefined — block navigation.
	throw new RouteSecurityBlockedError(pendingRequirement, result);
}

function isPromiseLike<T>(value: unknown): value is Promise<T> {
	return (
		typeof value === "object" &&
		value !== null &&
		"then" in value &&
		typeof value.then === "function"
	);
}

function neverSettlingBeforeLoadResult(): Promise<never> {
	return new Promise<never>(() => {
		// Intentionally never resolves: a full-page browser redirect is in progress.
	});
}

function isValidComposition(
	raw: unknown,
): raw is RequirementsClientSetComposition {
	return (
		raw === RequirementsClientSetComposition.Inherit ||
		raw === RequirementsClientSetComposition.Merge ||
		raw === RequirementsClientSetComposition.Replace
	);
}

// Unused import prevents TS from complaining if @tanstack/react-router types
// are not available at build time (peerDep is optional for pure orchestration).
export type { AnyRoute, RegisteredRouter };
// Re-export composition enum for adopter convenience
export { RequirementsClientSetComposition };
