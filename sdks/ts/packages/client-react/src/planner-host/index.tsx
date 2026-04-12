// React planner-host integration — Context-based planner provider / lookup
//
// Canonical import path:
//   import { AuthPlannerHostProvider, useAuthPlannerHost, ... } from "@securitydept/client-react"
//
// Provides React Context glue for the shared planner-host contract:
//   - AuthPlannerHostProvider: provides a PlannerHost at a React tree scope
//   - useAuthPlannerHost(): hook to look up the nearest PlannerHost (fail-fast)
//   - AuthRequirementsClientSetProvider: provides scoped requirement client sets
//   - useEffectiveClientSet(): resolves the current scope's effective client set
//
// Architecture boundary:
//   - Does NOT own the planner-host contract (that lives in @securitydept/client)
//   - Does NOT carry token-set-specific mapping
//   - Provides the React Context wiring for the shared contract
//
// Stability: provisional

import type {
	AuthGuardClientOption,
	CandidateSelector,
	PlannerHost,
	ScopedRequirementsClientSet,
} from "@securitydept/client/auth-coordination";
import {
	createPlannerHost,
	resolveEffectiveClientSet,
} from "@securitydept/client/auth-coordination";
import { createContext, type ReactNode, useContext, useMemo } from "react";

// ---------------------------------------------------------------------------
// PlannerHost context
// ---------------------------------------------------------------------------

const PlannerHostContext = createContext<PlannerHost | null>(null);

/** Props for {@link AuthPlannerHostProvider}. */
export interface AuthPlannerHostProviderProps {
	/**
	 * Custom candidate selection strategy.
	 * @see {@link CandidateSelector}
	 */
	selectCandidate?: CandidateSelector;

	/**
	 * Pre-constructed PlannerHost instance to use.
	 * If provided, `selectCandidate` is ignored.
	 */
	plannerHost?: PlannerHost;

	children: ReactNode;
}

/**
 * Provide a {@link PlannerHost} at the current React tree scope.
 *
 * Use at the app level or at feature-route boundaries to establish
 * planner-host scopes. Child components inherit the nearest provider.
 *
 * @example
 * ```tsx
 * // App-level (default sequential strategy)
 * <AuthPlannerHostProvider>
 *   <App />
 * </AuthPlannerHostProvider>
 *
 * // Feature-route with custom chooser
 * <AuthPlannerHostProvider selectCandidate={showChooser}>
 *   <FeatureRoutes />
 * </AuthPlannerHostProvider>
 * ```
 */
export function AuthPlannerHostProvider({
	selectCandidate,
	plannerHost,
	children,
}: AuthPlannerHostProviderProps) {
	const host = useMemo(() => {
		if (plannerHost) return plannerHost;
		return createPlannerHost(selectCandidate ? { selectCandidate } : undefined);
	}, [plannerHost, selectCandidate]);

	return (
		<PlannerHostContext.Provider value={host}>
			{children}
		</PlannerHostContext.Provider>
	);
}

/**
 * Look up the nearest {@link PlannerHost} from the React Context tree.
 *
 * Throws an explicit error if no provider is found, preventing
 * silent fallback behavior.
 */
export function useAuthPlannerHost(): PlannerHost {
	const host = useContext(PlannerHostContext);
	if (!host) {
		throw new Error(
			"[useAuthPlannerHost] No AuthPlannerHostProvider found in the component tree. " +
				"Wrap your app or route with <AuthPlannerHostProvider>.",
		);
	}
	return host;
}

// ---------------------------------------------------------------------------
// Requirements client set context
// ---------------------------------------------------------------------------

const RequirementsClientSetContext = createContext<
	readonly AuthGuardClientOption[]
>([]);

/** Props for {@link AuthRequirementsClientSetProvider}. */
export interface AuthRequirementsClientSetProviderProps {
	/** The scoped set to provide at this level. */
	scopedSet: ScopedRequirementsClientSet;
	children: ReactNode;
}

/**
 * Provide a {@link ScopedRequirementsClientSet} at the current React tree scope.
 *
 * Automatically resolves the effective client set by composing with the
 * parent scope's options according to the declared composition strategy.
 *
 * @example
 * ```tsx
 * // Feature route: merge OIDC requirement with parent's session requirement
 * <AuthRequirementsClientSetProvider
 *   scopedSet={{
 *     composition: RequirementsClientSetComposition.Merge,
 *     options: [oidcClientOption],
 *   }}
 * >
 *   <ProtectedFeature />
 * </AuthRequirementsClientSetProvider>
 * ```
 */
export function AuthRequirementsClientSetProvider({
	scopedSet,
	children,
}: AuthRequirementsClientSetProviderProps) {
	const parentOptions = useContext(RequirementsClientSetContext);
	const effective = useMemo(
		() => resolveEffectiveClientSet(parentOptions, scopedSet),
		[parentOptions, scopedSet],
	);

	return (
		<RequirementsClientSetContext.Provider value={effective}>
			{children}
		</RequirementsClientSetContext.Provider>
	);
}

/**
 * Get the effective requirements client set for the current React tree scope.
 *
 * Returns the resolved options after applying all parent/child composition.
 */
export function useEffectiveClientSet(): readonly AuthGuardClientOption[] {
	return useContext(RequirementsClientSetContext);
}

// Re-export composition constant for consumer convenience
export { resolveEffectiveClientSet };
