import {
	EnvironmentInjector,
	inject,
	runInInjectionContext,
} from "@angular/core";
import type {
	ActivatedRouteSnapshot,
	CanActivateFn,
	RouterStateSnapshot,
	UrlTree,
} from "@angular/router";
import { Router } from "@angular/router";
import type {
	AuthGuardClientOption,
	AuthRequirement,
	PlannerHost,
} from "@securitydept/client/auth-coordination";
import {
	AUTH_PLANNER_HOST,
	extractFullRouteRequirements,
} from "@securitydept/client-angular";
import type { AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
import { firstValueFrom, from, switchMap, take } from "rxjs";
import type { UnauthenticatedEntry } from "./guard-types";
import type { ClientMeta, ClientQueryOptions } from "./token-set-auth-registry";
import { TokenSetAuthRegistry } from "./token-set-auth-registry";

// ============================================================================
// Guard factory — createTokenSetRouteAggregationGuard() [LOWER-LEVEL ADVANCED]
//
// Canonical Angular Router auth pattern for multi-requirement coordination:
//
//   1. Declaration layer  — withRouteRequirements([...]) in route data
//   2. Aggregation layer  — this guard walks pathFromRoot once and collects
//                           the full requirement chain
//   3. Decision layer     — planner host evaluates all candidates in one call
//   4. Enforcement layer  — registry maps requirement.kind → client → action
//
// Fine-grained control is available via requirementPolicies[requirementId]:
//   - selector.clientKey / selector.query override the default kind→client mapping
//   - per-requirement onUnauthenticated takes precedence over kind handlers
//
// secureRouteRoot() / secureRoute() are the canonical adopter-facing path.
// This guard remains available as the lower-level route-tree primitive.
// ============================================================================

// ---------------------------------------------------------------------------
// Selector type — used in requirementPolicies to override client resolution
// ---------------------------------------------------------------------------

/**
 * How to select a token-set client from the registry for a specific requirement.
 *
 * Choose exactly one:
 * - `clientKey` — direct key lookup (explicit, single client)
 * - `query` — composite filter query ({@link ClientQueryOptions})
 */
export type TokenSetClientSelector =
	| { clientKey: string; query?: never }
	| { clientKey?: never; query: ClientQueryOptions };

/**
 * Runtime context passed to unauthenticated route handlers.
 *
 * `attemptedUrl` is the Angular Router target URL for the navigation being
 * guarded. Use it as `postAuthRedirectUri`; do not read `Router.url` for this,
 * because Angular still exposes the currently active URL while a guard is
 * deciding whether the attempted navigation may proceed.
 */
export interface TokenSetRouteUnauthenticatedContext {
	readonly route: ActivatedRouteSnapshot;
	readonly state: RouterStateSnapshot;
	readonly attemptedUrl: string;
}

export type TokenSetRouteUnauthenticatedHandler = (
	unauthenticated: ReadonlyArray<UnauthenticatedEntry>,
	requirement: AuthRequirement,
	context: TokenSetRouteUnauthenticatedContext,
) => boolean | string | UrlTree | Promise<boolean | string | UrlTree>;

// ---------------------------------------------------------------------------
// Per-requirement policy
// ---------------------------------------------------------------------------

/**
 * Policy override for a specific requirement ID in
 * {@link CreateTokenSetRouteAggregationGuardOptions.requirementPolicies}.
 *
 * Allows fine-grained control per declared requirement:
 * - `selector` overrides the default kind→client registry lookup (use when
 *   you need a specific client key or a query instead of all clients of that kind).
 * - `onUnauthenticated` overrides both `requirementHandlers[kind]` and
 *   `defaultOnUnauthenticated` for this exact requirement.
 *
 * @example
 * ```ts
 * createTokenSetRouteAggregationGuard({
 *   requirementPolicies: {
 *     "confluence-oidc": {
 *       selector: { clientKey: "confluence" },
 *       onUnauthenticated: (_failing, _req, context) => {
 *         inject(AuthService)
 *           .redirectToLogin("confluence", context.attemptedUrl)
 *           .subscribe();
 *         return false;
 *       },
 *     },
 *     "admin-oidc": {
 *       selector: { query: { providerFamily: "internal-sso" } },
 *       onUnauthenticated: () => "/admin/login",
 *     },
 *   },
 * })
 * ```
 */
export interface TokenSetRequirementPolicy {
	/**
	 * Override the default kind→client registry lookup for this requirement.
	 *
	 * When omitted, the guard resolves clients via
	 * `registry.clientKeyListForRequirement(requirement.kind)`.
	 */
	selector?: TokenSetClientSelector;

	/**
	 * Handler called when this requirement is selected as pending by the planner.
	 *
	 * Takes precedence over `requirementHandlers[kind]` and
	 * `defaultOnUnauthenticated`.
	 *
	 * Return:
	 *   - `true`  — allow navigation
	 *   - `false` — block navigation
	 *   - `string` — redirect URL path
	 *   - `UrlTree` — Angular router tree
	 */
	onUnauthenticated: TokenSetRouteUnauthenticatedHandler;
}

// ---------------------------------------------------------------------------
// Guard options
// ---------------------------------------------------------------------------

/**
 * Options for {@link createTokenSetRouteAggregationGuard}.
 */
export interface CreateTokenSetRouteAggregationGuardOptions {
	/**
	 * Per-requirement-id policies.
	 *
	 * Keys are `AuthRequirement.id` strings (not kind). Policies declared here
	 * take precedence over {@link requirementHandlers} and
	 * {@link defaultOnUnauthenticated}.
	 *
	 * Use this for fine-grained control:
	 * - override client selection (specific key or composite query)
	 * - per-requirement redirect behaviour
	 * - multi-client / providerFamily selection per requirement
	 *
	 * @example
	 * ```ts
	 * createTokenSetRouteAggregationGuard({
	 *   requirementPolicies: {
	 *     "confluence-oidc": {
	 *       selector: { clientKey: "confluence" },
	 *       onUnauthenticated: () => "/auth/confluence",
	 *     },
	 *     "admin-oidc": {
	 *       selector: { query: { providerFamily: "internal-sso" } },
	 *       onUnauthenticated: () => "/auth/admin",
	 *     },
	 *   },
	 * })
	 * ```
	 */
	requirementPolicies?: Record<string, TokenSetRequirementPolicy>;

	/**
	 * Per-requirement-kind handlers.
	 *
	 * When the planner selects a pending requirement whose `kind` maps to an
	 * entry here (and no `requirementPolicies[id]` is set), that handler is
	 * called instead of `defaultOnUnauthenticated`.
	 *
	 * Keys are `AuthRequirement.kind` strings.
	 *
	 * @example
	 * ```ts
	 * createTokenSetRouteAggregationGuard({
	 *   requirementHandlers: {
	 *     frontend_oidc: (failing, _req, context) => {
	 *       inject(AuthService)
	 *         .redirectToLogin(failing[0].clientKey, context.attemptedUrl)
	 *         .subscribe();
	 *       return false;
	 *     },
	 *   },
	 * })
	 * ```
	 */
	requirementHandlers?: Record<string, TokenSetRouteUnauthenticatedHandler>;

	/**
	 * Fallback handler used when no `requirementPolicies[id]` or
	 * `requirementHandlers[kind]` is found for the pending requirement.
	 */
	defaultOnUnauthenticated?: TokenSetRouteUnauthenticatedHandler;

	/**
	 * Custom route data key for reading requirements from route segments.
	 * @default "authRequirements"
	 */
	requirementsKey?: string;

	/**
	 * Inline planner-host instance. If provided, used instead of injecting
	 * `AUTH_PLANNER_HOST` from Angular DI.
	 */
	plannerHost?: PlannerHost;

	/**
	 * Resolve the planner-host for the current target route chain.
	 *
	 * Use this when planner-host selection depends on route metadata or other
	 * route-tree state. Takes precedence over `plannerHost` and DI lookup.
	 */
	plannerHostResolver?: (
		route: ActivatedRouteSnapshot,
		state: RouterStateSnapshot,
	) => PlannerHost | undefined;
}

// ---------------------------------------------------------------------------
// Guard factory
// ---------------------------------------------------------------------------

/**
 * Create an Angular `CanActivateFn` that performs full-route requirement
 * aggregation and single-pass planner evaluation.
 *
 * **Canonical Angular Router auth pattern** (route-metadata driven):
 * 1. Requirements are declared in route `data` using `withRouteRequirements()`.
 * 2. When the guard runs, it walks `route.pathFromRoot` to collect ALL
 *    requirements from every ancestor segment in a single pass.
 * 3. Each requirement's `kind` is mapped to one or more registry clients,
 *    unless overridden by a `requirementPolicies[id].selector`.
 * 4. The complete candidate set is handed to the `PlannerHost` for a
 *    single `evaluate()` call — the planner selects the first unresolved
 *    requirement and calls the matching handler.
 *
 * **Handler resolution order** (most specific wins):
 * 1. `requirementPolicies[requirement.id].onUnauthenticated`
 * 2. `requirementHandlers[requirement.kind]`
 * 3. `defaultOnUnauthenticated`
 * 4. Block navigation (`false`) if none of the above is provided.
 *
 * **Client resolution order** for a requirement:
 * 1. `requirementPolicies[requirement.id].selector.clientKey` — single explicit key
 * 2. `requirementPolicies[requirement.id].selector.query` — composite query
 * 3. `registry.clientKeyListForRequirement(requirement.kind)` — default mapping
 *
 * This model enables:
 *   - One-pass requirement collection (no per-segment DI scope accumulation)
 *   - One-call planner evaluation (chooser sees the full set at once)
 *   - One redirect decision (no per-segment guard coordination needed)
 *   - Fine-grained per-requirement policy via `requirementPolicies`
 *
 * @example
 * ```ts
 * // routes.ts — declare requirements in route data
 * import { withRouteRequirements } from "@securitydept/client-angular";
 * import {
 *   createFrontendOidcLoginRedirectHandler,
 *   createTokenSetRouteAggregationGuard,
 * } from "@securitydept/token-set-context-client-angular";
 *
 * // Simple — kind-level handler
 * const guard = createTokenSetRouteAggregationGuard({
 *   requirementHandlers: {
 *     frontend_oidc: createFrontendOidcLoginRedirectHandler({ clientKey: "confluence" }),
 *   },
 * });
 *
 * // Fine-grained — per-requirement policy
 * const guard = createTokenSetRouteAggregationGuard({
 *   requirementPolicies: {
 *     "confluence-oidc": {
 *       selector: { clientKey: "confluence" },
 *       onUnauthenticated: () => "/auth/confluence",
 *     },
 *     "admin-oidc": {
 *       selector: { query: { providerFamily: "internal-sso" } },
 *       onUnauthenticated: (failing) => "/auth/admin",
 *     },
 *   },
 * });
 *
 * export const routes: Routes = [
 *   {
 *     path: "",
 *     data: withRouteRequirements([{ id: "session", kind: "session" }]),
 *     children: [
 *       {
 *         path: "confluence",
 *         data: withRouteRequirements([{ id: "confluence-oidc", kind: "frontend_oidc" }]),
 *         canActivate: [guard],
 *       },
 *     ],
 *   },
 * ];
 * ```
 */
export function createTokenSetRouteAggregationGuard(
	options: CreateTokenSetRouteAggregationGuardOptions = {},
): CanActivateFn {
	return async (route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
		const injector = inject(EnvironmentInjector);
		const registry = inject(TokenSetAuthRegistry);
		const router = inject(Router);
		const handlerContext: TokenSetRouteUnauthenticatedContext = {
			route,
			state,
			attemptedUrl: state.url,
		};

		// ── Resolve planner-host ────────────────────────────────────────────
		const plannerHost =
			options.plannerHostResolver?.(route, state) ??
			options.plannerHost ??
			inject(AUTH_PLANNER_HOST, { optional: true });

		if (!plannerHost) {
			throw new Error(
				"[createTokenSetRouteAggregationGuard] No PlannerHost found. " +
					"Provide AUTH_PLANNER_HOST via provideAuthPlannerHost() " +
					"in your app/route providers, or pass plannerHost inline.",
			);
		}

		// ── Step 1: Full-route requirement aggregation ───────────────────────
		const allRequirements = extractFullRouteRequirements(
			route,
			options.requirementsKey,
		);

		if (allRequirements.length === 0) {
			return true;
		}

		// ── Step 2: Map requirements → registry clients ──────────────────────
		// Per-requirement policy may override the default kind→client mapping.
		interface ResolvedRequirementEntry {
			requirement: AuthRequirement;
			entries: UnauthenticatedEntry[];
		}

		const resolvedRequirements: ResolvedRequirementEntry[] = [];

		for (const req of allRequirements) {
			const policy = options.requirementPolicies?.[req.id];
			let clientKeys: string[];

			if (policy?.selector) {
				// Policy provides an explicit selector — use it instead of kind mapping.
				if (policy.selector.clientKey !== undefined) {
					clientKeys = [policy.selector.clientKey];
				} else {
					clientKeys = registry.clientKeysForOptions(policy.selector.query);
				}
			} else {
				// Default: resolve by requirement kind.
				clientKeys = registry.clientKeyListForRequirement(req.kind);
			}

			if (clientKeys.length === 0) {
				// No client for this requirement — skip (lets non-token-set requirements
				// coexist in the same route chain without breaking the guard).
				continue;
			}

			const entries: UnauthenticatedEntry[] = await Promise.all(
				clientKeys.map(async (key) => ({
					// Use whenReady() — not require() — so that if the client's
					// async clientFactory is still in-flight when the guard first
					// fires, we block here until it materializes rather than
					// crashing or silently bypassing auth.
					service: await registry.whenReady(key),
					clientKey: key,
					meta: registry.metaFor(key) as ClientMeta,
				})),
			);

			resolvedRequirements.push({ requirement: req, entries });
		}

		if (resolvedRequirements.length === 0) {
			return true;
		}

		// ── Step 3: Build planner candidates ────────────────────────────────
		// De-duplicate by requirementId (last declaration for the same id wins).
		const seenIds = new Map<string, ResolvedRequirementEntry>();
		for (const r of resolvedRequirements) {
			seenIds.set(r.requirement.id, r);
		}
		const deduped = [...seenIds.values()];

		const candidates: Array<
			AuthGuardClientOption & { _resolved: ResolvedRequirementEntry }
		> = deduped.map((r) => ({
			requirementId: r.requirement.id,
			requirementKind: r.requirement.kind,
			label: r.requirement.label,
			attributes: r.requirement.attributes,
			checkAuthenticated: () =>
				r.entries.every(({ service }) => service.isAuthenticated()),
			onUnauthenticated: async (): Promise<boolean | string> => {
				const failing = r.entries.filter(
					({ service }) => !service.isAuthenticated(),
				);
				// Handler resolution: policy > kind handler > default
				const handler =
					options.requirementPolicies?.[r.requirement.id]?.onUnauthenticated ??
					options.requirementHandlers?.[r.requirement.kind] ??
					options.defaultOnUnauthenticated;

				if (!handler) return false;

				const result = runUnauthenticatedHandlerInContext(
					injector,
					handler,
					failing,
					r.requirement,
					handlerContext,
				);
				const resolved = await result;
				if (typeof resolved === "string") return resolved;
				if (typeof resolved === "boolean") return resolved;
				return resolved.toString();
			},
			_resolved: r,
		}));

		// ── Step 4: Single planner evaluation ───────────────────────────────
		const decide = async (): Promise<boolean | UrlTree> => {
			const result = await plannerHost.evaluate(candidates);

			if (result.allAuthenticated) return true;

			if (result.pendingCandidate) {
				const candidate = result.pendingCandidate as AuthGuardClientOption & {
					_resolved: ResolvedRequirementEntry;
				};
				const failing = candidate._resolved.entries.filter(
					({ service }) => !service.isAuthenticated(),
				);
				// Handler resolution: policy > kind handler > default
				const handler =
					options.requirementPolicies?.[candidate._resolved.requirement.id]
						?.onUnauthenticated ??
					options.requirementHandlers?.[candidate._resolved.requirement.kind] ??
					options.defaultOnUnauthenticated;

				if (!handler) return false;

				const action = await runUnauthenticatedHandlerInContext(
					injector,
					handler,
					failing,
					candidate._resolved.requirement,
					handlerContext,
				);
				if (typeof action === "string") return router.parseUrl(action);
				if (typeof action === "boolean") return action;
				return action;
			}

			return false;
		};

		// ── Restore-aware: wait for all pending restores ─────────────────────
		const pendingRestores = deduped
			.flatMap((r) => r.entries)
			.map(({ service }) => service.restorePromise)
			.filter((p): p is Promise<AuthSnapshot | null> => p !== null);

		if (pendingRestores.length === 0) {
			return decide();
		}

		// await the restore-phase Observable before running planner evaluation
		// so the async guard always returns a Promise, not an Observable.
		return firstValueFrom(
			from(Promise.all(pendingRestores)).pipe(
				switchMap(() => from(decide())),
				take(1),
			),
		);
	};
}

function runUnauthenticatedHandlerInContext(
	injector: EnvironmentInjector,
	handler: TokenSetRouteUnauthenticatedHandler,
	unauthenticated: ReadonlyArray<UnauthenticatedEntry>,
	requirement: AuthRequirement,
	context: TokenSetRouteUnauthenticatedContext,
): boolean | string | UrlTree | Promise<boolean | string | UrlTree> {
	return runInInjectionContext(injector, () =>
		handler(unauthenticated, requirement, context),
	);
}

/**
 * Build an Angular route-security handler that starts frontend-oidc login and
 * records the attempted navigation URL as `postAuthRedirectUri`.
 *
 * Use this instead of reading `Router.url` inside a guard handler. During guard
 * execution Angular has not committed the attempted navigation yet, so
 * `Router.url` still points at the previously active page.
 *
 * After the browser redirect is started, the returned guard result intentionally
 * never settles. That keeps Angular from finalizing the rejected in-app
 * navigation while the page is already leaving for an external IdP.
 */
export function createFrontendOidcLoginRedirectHandler(options?: {
	/**
	 * Explicit client key. When omitted, the first failing registry entry is
	 * used, which is the common one-client-per-requirement case.
	 */
	clientKey?: string;
	/**
	 * Fallback used only when Angular does not provide a target URL.
	 * @default "/"
	 */
	fallbackPostAuthRedirectUri?: string;
}): TokenSetRouteUnauthenticatedHandler {
	return async (unauthenticated, _requirement, context) => {
		const clientKey = options?.clientKey ?? unauthenticated[0]?.clientKey;
		if (!clientKey) return false;

		const registry = inject(TokenSetAuthRegistry);
		const service = await registry.whenReady(clientKey);
		if (!isLoginWithRedirectClient(service.client)) return false;

		await service.client.loginWithRedirect({
			postAuthRedirectUri:
				context.attemptedUrl || options?.fallbackPostAuthRedirectUri || "/",
		});
		return await neverSettlingRedirectGuardResult();
	};
}

function neverSettlingRedirectGuardResult(): Promise<never> {
	return new Promise<never>(() => {
		// Intentionally never resolves: a full-page browser redirect is in progress.
	});
}

interface LoginWithRedirectClient {
	loginWithRedirect(options?: { postAuthRedirectUri?: string }): Promise<void>;
}

function isLoginWithRedirectClient(
	client: unknown,
): client is LoginWithRedirectClient {
	return (
		typeof client === "object" &&
		client !== null &&
		"loginWithRedirect" in client &&
		typeof client.loginWithRedirect === "function"
	);
}
