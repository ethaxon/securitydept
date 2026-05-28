export type {
	GuardedRouterTrait,
	RouterBeforeLoad,
	RouterGuardContext,
	RouterGuardDecision,
} from "./guard";
export { RouterGuardDecisionKind, RouterGuardPhase } from "./guard";
export type { RouterNavigationRequest, RouterTrait } from "./router";
export {
	ROUTER_TRAIT_TOKEN,
	RouterTraitSchema,
	takeCompatFragmentFromRouter,
} from "./router";
