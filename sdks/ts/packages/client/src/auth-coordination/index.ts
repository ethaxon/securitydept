// Shared auth coordination — headless multi-requirement orchestration primitives
//
// Canonical root export: @securitydept/client
//
// Layers:
//   - contract.ts        serializable types + pure composition
//   - planner-host.ts    non-serializable behaviour, resolved through a parent chain
//   - planner/*          pipeline owner (base) + source-strategy variants
//
// These primitives are mode-agnostic, framework-agnostic, and keyed only by
// opaque requirement entity ids.
//
// Stability: provisional (additive, shared coordination capability)

// --- Contract ---
export {
	type AuthenticatedCheck,
	type AuthRequirement,
	type CheckAuthenticated,
	isRouteBehaviourContextExtra,
	isRouteStateSnapshotTrait,
	type OnUnauthenticated,
	PipelineOutcome,
	type PipelineRunResult,
	type PipelineStepResult,
	PlanStatus,
	type RequirementBehaviour,
	type RequirementBehaviourContext,
	type RequirementBehaviourWithRouteContext,
	type RequirementCandidateGenerator,
	type RequirementCandidateSelectionContext,
	RequirementPlannerError,
	type RequirementResolution,
	RequirementsComposition,
	ResolutionStatus,
	type RouteBehaviourContextExtra,
	type RouteRequirementsDeclaration,
	type RouteStateSnapshotTrait,
	type RouteTreeSegment,
	resolveEffectiveRequirements,
	type SelectCandidate,
	StaticAttrsAuthRequirement,
	type StaticAttrsAuthRequirementInput,
	type UnauthenticatedAction,
} from "./contract";
// --- Planners ---
export {
	BaseRequirementPlanner,
	MergeRequirementPlanner,
	type RequirementPlan,
	RouteCompositionRequirementPlanner,
	StaticRequirementPlanner,
} from "./planner";
// --- Planner Host ---
export {
	defaultSelectCandidate,
	type InjectRequirementPlannerHostOptions,
	injectRequirementPlannerHost,
	type ProvideRequirementPlannerHostOptions,
	provideRequirementPlannerHost,
	REQUIREMENT_PLANNER_HOST,
	RequirementPlannerHost,
	type RequirementPlannerHostBehaviour,
	type RequirementPlannerHostOptions,
} from "./planner-host";
