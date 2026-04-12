// Angular planner-host integration — DI-based planner provider / lookup
//
// Canonical import path:
//   import { AUTH_PLANNER_HOST, provideAuthPlannerHost, ... } from "@securitydept/client-angular"
//
// Provides Angular DI glue for the shared planner-host contract:
//   - InjectionToken for PlannerHost
//   - Provider helpers for app / module / route scoped planners
//   - InjectionToken + provider helpers for ScopedRequirementsClientSet
//   - injectPlannerHost() convenience function with fail-fast
//
// Architecture boundary:
//   - Does NOT own the planner-host contract (that lives in @securitydept/client)
//   - Does NOT carry token-set-specific mapping
//   - Provides the Angular DI wiring for the shared contract
//
// Stability: provisional

import {
	type EnvironmentProviders,
	InjectionToken,
	inject,
	makeEnvironmentProviders,
} from "@angular/core";
import type {
	AuthGuardClientOption,
	CandidateSelector,
	CreatePlannerHostOptions,
	PlannerHost,
	ScopedRequirementsClientSet,
} from "@securitydept/client/auth-coordination";
import {
	createPlannerHost,
	resolveEffectiveClientSet,
} from "@securitydept/client/auth-coordination";

// ---------------------------------------------------------------------------
// PlannerHost injection token
// ---------------------------------------------------------------------------

/**
 * DI token for the shared {@link PlannerHost}.
 *
 * Provide at the app level via {@link provideAuthPlannerHost}.
 * Guards use {@link injectPlannerHost} to look up the nearest instance.
 */
export const AUTH_PLANNER_HOST = new InjectionToken<PlannerHost>(
	"AUTH_PLANNER_HOST",
);

/**
 * Options for {@link provideAuthPlannerHost}.
 */
export interface ProvideAuthPlannerHostOptions {
	/**
	 * Custom candidate selection strategy.
	 * @see {@link CandidateSelector}
	 */
	selectCandidate?: CandidateSelector;
}

/**
 * Provide an {@link AUTH_PLANNER_HOST} at the current injector level.
 *
 * Use in app config, route providers, or NgModule providers to establish
 * a planner-host scope. Child routes inherit the nearest parent's planner.
 *
 * @example
 * ```ts
 * // app.config.ts — app-level planner (default sequential strategy)
 * export const appConfig: ApplicationConfig = {
 *   providers: [provideAuthPlannerHost()],
 * };
 *
 * // Feature route — override with custom async chooser strategy
 * {
 *   path: "admin",
 *   providers: [provideAuthPlannerHost({
 *     selectCandidate: async (candidates) => showAdminChooser(candidates),
 *   })],
 *   children: [...]
 * }
 * ```
 */
export function provideAuthPlannerHost(
	options?: ProvideAuthPlannerHostOptions,
): EnvironmentProviders {
	const plannerOptions: CreatePlannerHostOptions = {};
	if (options?.selectCandidate) {
		plannerOptions.selectCandidate = options.selectCandidate;
	}
	return makeEnvironmentProviders([
		{ provide: AUTH_PLANNER_HOST, useValue: createPlannerHost(plannerOptions) },
	]);
}

/**
 * Inject the nearest {@link PlannerHost} from the DI hierarchy.
 *
 * Throws an explicit error if no planner-host is provided, preventing
 * silent fallback behavior.
 *
 * @example
 * ```ts
 * const plannerHost = injectPlannerHost();
 * const result = await plannerHost.evaluate(candidates);
 * ```
 */
export function injectPlannerHost(): PlannerHost {
	const host = inject(AUTH_PLANNER_HOST, { optional: true });
	if (!host) {
		throw new Error(
			"[injectPlannerHost] No AUTH_PLANNER_HOST found in the injector hierarchy. " +
				"Use provideAuthPlannerHost() in your app config or route providers.",
		);
	}
	return host;
}

// ---------------------------------------------------------------------------
// Requirements client set injection token — stores the already-resolved
// effective options for the current scope (parent + child composed).
// ---------------------------------------------------------------------------

/**
 * DI token for the effective requirements client set at the current scope.
 *
 * The value is always the **resolved** options after composing all ancestor
 * scopes — it is NOT the raw `ScopedRequirementsClientSet` declaration.
 *
 * Provide via {@link provideRouteScopedRequirements}.
 * Guards inject this token to get the effective scope requirements and then
 * merge their own declared candidates on top.
 */
export const AUTH_REQUIREMENTS_CLIENT_SET = new InjectionToken<
	readonly AuthGuardClientOption[]
>("AUTH_REQUIREMENTS_CLIENT_SET");

/**
 * Provide a {@link ScopedRequirementsClientSet} at the current route/module scope.
 *
 * Internally, the provider resolves the effective client set by composing the
 * declared `scopedSet` with the parent scope's already-resolved options
 * (injected via `skipSelf: true`). The token value stored in DI is the
 * resolved `readonly AuthGuardClientOption[]`, not the raw declaration.
 *
 * This mirrors the React `AuthRequirementsClientSetProvider` semantics:
 * each level stores its resolved effective options, so children inherit
 * the composed result without re-resolving the full ancestor chain.
 *
 * The `scopedSet` argument may also be a **factory function** — it will be
 * called inside Angular's `useFactory` context, so `inject()` is valid.
 * Use this when the requirement options need DI-resolved services (e.g. a
 * token-set registry or a redirect service).
 *
 * @example
 * ```ts
 * // routes.ts — static declaration (no DI needed)
 * {
 *   path: "",
 *   providers: [
 *     provideRouteScopedRequirements({
 *       composition: RequirementsClientSetComposition.Replace,
 *       options: [sessionClientOption],
 *     }),
 *   ],
 * }
 *
 * // Feature route merges OIDC on top of the parent's session requirement
 * {
 *   path: "confluence",
 *   providers: [
 *     provideRouteScopedRequirements({
 *       composition: RequirementsClientSetComposition.Merge,
 *       options: [confluenceOidcClientOption],
 *     }),
 *   ],
 *   // Route-level DI scope only. Angular Router adopters should prefer
 *   // secureRouteRoot()/secureRoute() over direct guard wiring.
 * }
 *
 * // Factory form — use when options depend on injected services
 * {
 *   path: "protected",
 *   providers: [
 *     provideRouteScopedRequirements(() => {
 *       const registry = inject(TokenSetAuthRegistry);
 *       const authService = inject(AuthService);
 *       return {
 *         composition: RequirementsClientSetComposition.Replace,
 *         options: [{
 *           requirementId: "oidc",
 *           requirementKind: "frontend_oidc",
 *           checkAuthenticated: () => registry.require(clientKey).isAuthenticated(),
 *           onUnauthenticated: () => { authService.redirectToLogin(clientKey).subscribe(); return false; },
 *         }],
 *       };
 *     }),
 *   ],
 * }
 * ```
 */
export function provideRouteScopedRequirements(
	scopedSet: ScopedRequirementsClientSet | (() => ScopedRequirementsClientSet),
): EnvironmentProviders {
	return makeEnvironmentProviders([
		{
			provide: AUTH_REQUIREMENTS_CLIENT_SET,
			useFactory: (): readonly AuthGuardClientOption[] => {
				// Walk up to the nearest parent scope's already-resolved effective set.
				// skipSelf: true ensures we don't read our own (not-yet-set) value.
				const parentOptions: readonly AuthGuardClientOption[] =
					inject(AUTH_REQUIREMENTS_CLIENT_SET, {
						optional: true,
						skipSelf: true,
					}) ?? [];
				// Support factory form so callers can use inject() to resolve
				// DI services (e.g. auth registry, redirect service) inside their
				// option callbacks without bypassing this helper.
				const resolved =
					typeof scopedSet === "function" ? scopedSet() : scopedSet;
				return resolveEffectiveClientSet(parentOptions, resolved);
			},
		},
	]);
}

// Re-export composition helpers so consumers don't need a second import
export { resolveEffectiveClientSet };
