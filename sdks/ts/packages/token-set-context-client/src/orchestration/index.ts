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
// NOTE: The shared auth requirement orchestration primitives (requirement planner,
// route orchestrator) have moved to @securitydept/client/auth-coordination.
// Migration: see docs/en/110-TS_SDK_MIGRATIONS.md
//
// Current status: PUBLIC subpath within token-set-context-client (same npm package).
// Stability: provisional (additive, freezing-in-progress; not yet promoted to stable).
// Not a separate npm package — extraction path is clear if warranted later.

// Base client: shared lifecycle infrastructure for mode-specific clients.
export type {
	BaseOidcModeClientOptions,
	EnsureAuthForResourceOptions,
	EnsureAuthForResourceRequirement,
	EnsureAuthForResourceResult,
	EnsureAuthorizationHeaderOptions,
	EnsureFreshAuthStateOptions,
} from "./client/base-client";
export {
	BaseOidcModeClient,
	describeError,
	EnsureAuthForResourceStatus,
	StateRestoreSourceKind,
} from "./client/base-client";
export type {
	CreateTokenSetAuthEventOptions,
	TokenSetAuthErrorSummary,
	TokenSetAuthEvent,
	TokenSetAuthEventPayload,
} from "./events/auth-events";
export {
	createTokenSetAuthEvent,
	eventSourceForAuthFlow,
	summarizeAuthError,
	TokenSetAuthEventType,
	TokenSetAuthFlowOutcome,
	TokenSetAuthFlowReason,
	TokenSetAuthFlowSource,
} from "./events/auth-events";
// Controller: thin lifecycle layer that composes state + persistence + transport.
export type {
	ApplyDeltaOptions,
	AuthMaterialController,
	AuthMaterialState,
	CreateAuthMaterialControllerOptions,
} from "./state/controller";
export { createAuthMaterialController } from "./state/controller";
export type {
	AuthStatePersistence,
	CreateAuthStatePersistenceOptions,
} from "./state/persistence";
export { createAuthStatePersistence } from "./state/persistence";
export type {
	AttachTokenSetResumeReconciliationOptions,
	TokenSetResumeReconciliationClient,
	TokenSetResumeReconciliationOptions,
} from "./state/resume-reconciliation";
export {
	attachTokenSetResumeReconciliation,
	createTokenSetResumeReconciler,
	shouldReconcileTokenSetSnapshot,
} from "./state/resume-reconciliation";
export type {
	CreateTokenHandleStoreOptions,
	IssueTokenHandleOptions,
	TokenHandleDescriptor,
	TokenHandleStore,
} from "./token/token-handle-store";
export {
	createTokenHandleStore,
	TokenHandleKind,
} from "./token/token-handle-store";
export type { TokenFreshnessOptions } from "./token/token-ops";
export {
	bearerHeader,
	freshBearerHeader,
	getTokenFreshness,
	isAccessTokenUsable,
	mergeTokenDelta,
	shouldRefreshAccessToken,
	TokenFreshnessState,
} from "./token/token-ops";
export type {
	AuthDelta,
	AuthMetadataDelta,
	AuthMetadataSnapshot,
	AuthPrincipal,
	AuthSnapshot,
	AuthSource,
	TokenDelta,
	TokenSnapshot,
} from "./token/types";
export { AuthSourceKind } from "./token/types";
export type {
	AsyncBearerHeaderProvider,
	AuthForResourceProvider,
	AuthorizationHeaderProviderTrait,
	BearerHeaderProvider,
	CreateAuthorizedTransportOptions,
	CreateRemappingAuthorizedTransportOptions,
} from "./transport/auth-transport";
export {
	createAuthorizedTransport,
	createRemappingAuthorizedTransport,
} from "./transport/auth-transport";
