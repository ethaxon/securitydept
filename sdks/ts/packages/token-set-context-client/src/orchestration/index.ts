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

export type {
	CreateTokenSetAuthEventOptions,
	TokenSetAuthErrorSummary,
	TokenSetAuthEvent,
	TokenSetAuthEventPayload,
} from "./auth-events";
export {
	createTokenSetAuthEvent,
	eventSourceForAuthFlow,
	summarizeAuthError,
	TokenSetAuthEventType,
	TokenSetAuthFlowOutcome,
	TokenSetAuthFlowReason,
	TokenSetAuthFlowSource,
} from "./auth-events";
export type {
	AsyncBearerHeaderProvider,
	AuthForResourceProvider,
	BearerHeaderProvider,
	CreateAuthorizedTransportOptions,
} from "./auth-transport";
export { createAuthorizedTransport } from "./auth-transport";
// Base client: shared lifecycle infrastructure for mode-specific clients.
export type {
	BaseOidcModeClientOptions,
	EnsureAuthForResourceOptions,
	EnsureAuthForResourceRequirement,
	EnsureAuthForResourceResult,
	EnsureAuthorizationHeaderOptions,
	EnsureFreshAuthStateOptions,
} from "./base-client";
export {
	BaseOidcModeClient,
	describeError,
	EnsureAuthForResourceStatus,
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
export type {
	AttachTokenSetResumeReconciliationOptions,
	TokenSetResumeReconciliationClient,
	TokenSetResumeReconciliationOptions,
} from "./resume-reconciliation";
export {
	attachTokenSetResumeReconciliation,
	createTokenSetResumeReconciler,
	shouldReconcileTokenSetSnapshot,
} from "./resume-reconciliation";
export type {
	CreateTokenHandleStoreOptions,
	IssueTokenHandleOptions,
	TokenHandleDescriptor,
	TokenHandleStore,
} from "./token-handle-store";
export {
	createTokenHandleStore,
	TokenHandleKind,
} from "./token-handle-store";
export type { TokenFreshnessOptions } from "./token-ops";
export {
	bearerHeader,
	freshBearerHeader,
	getTokenFreshness,
	isAccessTokenUsable,
	mergeTokenDelta,
	shouldRefreshAccessToken,
	TokenFreshnessState,
} from "./token-ops";
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
