// --- Generic Token Orchestration Layer ---
//
// This module is the primary entry point for the protocol-agnostic token
// orchestration sublayer of @securitydept/token-set-context-client.
// It is also accessible as a dedicated subpath import:
//
//   import { ... } from "@securitydept/token-set-context-client/orchestration"
//
// Contents: token snapshot types, delta merge, bearer projection, persistence,
// and authorized transport — all without any OIDC-mediated sealed flow semantics.
//
// Current status: PUBLIC subpath within token-set-context-client (same npm package).
// Stability: provisional (additive, freezing-in-progress; not yet promoted to stable).
// Not a separate npm package — extraction path is clear if warranted later.

export type {
	BearerHeaderProvider,
	CreateAuthorizedTransportOptions,
} from "./auth-transport";
export { createAuthorizedTransport } from "./auth-transport";
// Base client: shared lifecycle infrastructure for mode-specific clients.
export type { BaseOidcModeClientOptions } from "./base-client";
export {
	BaseOidcModeClient,
	describeError,
	StateRestoreSourceKind,
} from "./base-client";
// Controller: thin lifecycle layer that composes state + persistence + transport.
export type {
	ApplyDeltaOptions,
	AuthMaterialController,
	AuthMaterialState,
	CreateAuthMaterialControllerOptions,
} from "./controller";
export { createAuthMaterialController } from "./controller";
export type {
	AuthStatePersistence,
	CreateAuthStatePersistenceOptions,
} from "./persistence";
export { createAuthStatePersistence } from "./persistence";
// Multi-requirement orchestration planner
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
	RequirementKind,
	RequirementPlannerError,
	ResolutionStatus,
} from "./requirement-planner";
export { bearerHeader, mergeTokenDelta } from "./token-ops";
export type {
	AuthDelta,
	AuthMetadataDelta,
	AuthMetadataSnapshot,
	AuthPrincipal,
	AuthSnapshot,
	AuthSource,
	TokenDelta,
	TokenSnapshot,
} from "./types";
export { AuthSourceKind } from "./types";
