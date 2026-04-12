// Shared auth coordination — headless multi-requirement orchestration primitives
//
// Canonical subpath: @securitydept/client/auth-coordination
//
// This module is the new canonical owner of the requirement planner and
// route requirement orchestrator. These primitives are:
//
//   - Mode-agnostic: they do not depend on token-set, session, or basic-auth
//     domain objects
//   - Framework-agnostic: they do not depend on Angular, React, or any
//     browser/Node.js API
//   - Cross-auth-context: designed to coordinate across session, OIDC, and
//     custom requirement kinds
//
// Owner decision: moved from @securitydept/token-set-context-client/orchestration
// to @securitydept/client in iteration 102. The token-set package retains a
// thin provisional compat re-export under the old subpath, scheduled for
// removal in a future release.
//
// Stability: provisional (additive, shared coordination capability)

// --- Planner Host ---
export type {
	AuthGuardClientOption,
	CandidateSelector,
	CreatePlannerHostOptions,
	PlannerHost,
	PlannerHostResult,
	RequirementsClientSet,
	ScopedRequirementsClientSet,
} from "./planner-host";
export {
	createPlannerHost,
	RequirementsClientSetComposition,
	resolveEffectiveClientSet,
} from "./planner-host";
// --- Requirement Planner ---
export type {
	AuthRequirement,
	CreateRequirementPlannerOptions,
	PlanSnapshot,
	RequirementPlanner,
	RequirementResolution,
} from "./requirement-planner";
export {
	createRequirementPlanner,
	PlanStatus,
	RequirementPlannerError,
	ResolutionStatus,
} from "./requirement-planner";
// --- Route Requirement Orchestrator ---
export type {
	ChooserDecision,
	CreateRouteRequirementOrchestratorOptions,
	RouteMatchNode,
	RouteOrchestrationSnapshot,
	RouteRequirementOrchestrator,
} from "./route-orchestrator";
export { createRouteRequirementOrchestrator } from "./route-orchestrator";
