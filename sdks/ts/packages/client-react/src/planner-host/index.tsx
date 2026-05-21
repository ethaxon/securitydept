// React planner-host integration — injector tokens and plain factories
//
// Canonical import path:
//   import { AUTH_PLANNER_HOST, provideAuthPlannerHost, ... } from "@securitydept/client-react"
//
// Provides injection tokens and injector/plain factories for the shared
// planner-host contract. React trees compose these through SecuritydeptProvider;
// no domain-specific React Context is created here.
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
import {
	SecuritydeptInjectionToken,
	SecuritydeptInjector,
	type SecuritydeptInjectorTrait,
	type SecuritydeptProvider,
} from "@securitydept/client/injection";

export const AUTH_PLANNER_HOST = new SecuritydeptInjectionToken<PlannerHost>(
	"AUTH_PLANNER_HOST",
);

export interface ProvideAuthPlannerHostOptions {
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
}

export function provideAuthPlannerHost({
	selectCandidate,
	plannerHost,
}: ProvideAuthPlannerHostOptions = {}): SecuritydeptProvider<PlannerHost> {
	return {
		provide: AUTH_PLANNER_HOST,
		useValue:
			plannerHost ??
			createPlannerHost(selectCandidate ? { selectCandidate } : undefined),
	};
}

export const AUTH_REQUIREMENTS_CLIENT_SET = new SecuritydeptInjectionToken<
	readonly AuthGuardClientOption[]
>("AUTH_REQUIREMENTS_CLIENT_SET");

export function provideRequirementsClientSet(
	options: readonly AuthGuardClientOption[],
): SecuritydeptProvider<readonly AuthGuardClientOption[]> {
	return {
		provide: AUTH_REQUIREMENTS_CLIENT_SET,
		useValue: [...options],
	};
}

export function createRequirementsClientSetInjector(
	parentInjector: SecuritydeptInjectorTrait,
	scopedSet: ScopedRequirementsClientSet,
): SecuritydeptInjector {
	return SecuritydeptInjector.fromParentInjector(parentInjector, [
		provideRequirementsClientSet(
			resolveEffectiveClientSet(
				parentInjector.get(AUTH_REQUIREMENTS_CLIENT_SET, []),
				scopedSet,
			),
		),
	]);
}

// Re-export composition constant for consumer convenience
export { resolveEffectiveClientSet };
