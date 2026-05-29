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
export type {
	AuthenticatedCheck,
	AuthRequirement,
	AuthRequirementInput,
	CheckAuthenticated,
	OnUnauthenticated,
	PipelineRunResult,
	PipelineStepResult,
	RequirementBehaviour,
	RequirementBehaviourContext,
	RequirementResolution,
	RouteRequirementsDeclaration,
	RouteTreeSegment,
	SelectCandidate,
	UnauthenticatedAction,
} from "./contract";
export {
	createAuthRequirement,
	createAuthRequirements,
	PipelineOutcome,
	PlanStatus,
	RequirementPlannerError,
	RequirementsComposition,
	ResolutionStatus,
	resolveEffectiveRequirements,
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
export type { RequirementPlannerHostOptions } from "./planner-host";
export { RequirementPlannerHost } from "./planner-host";
