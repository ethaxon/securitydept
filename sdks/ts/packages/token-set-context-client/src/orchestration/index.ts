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
	ClientErrorAttributes,
	ClientErrorRecovery,
	ErrorAttributes,
	NativeErrorAttributes,
	UnknownErrorAttributes,
} from "@securitydept/client";
export { describeError } from "@securitydept/client";
// Base client: shared lifecycle infrastructure for mode-specific clients.
export type {
	BaseOidcModeClientOptions,
	TokenSetAuthOperationSignals,
} from "./client/base-client";
export {
	AuthCheckStatus,
	BaseOidcModeClient,
	PersistPolicy,
	StateRestoreSourceKind,
} from "./client/base-client";
export type {
	AuthWorkflowRuntimeOptions,
	AuthWorkflowSource as TokenSetAuthWorkflowSource,
	AuthWorkflowSourcesOptions,
	BuiltinAuthWorkflowSourceOption as BuiltinWorkflowSourceOption,
	PageResumeWorkflowSourceOptions,
} from "./client/workflows/source";
export {
	createPageResumeWorkflowSource,
	createRefreshTimerWorkflowSource,
} from "./client/workflows/source";
export type {
	CreateTokenSetAuthEventOptions,
	TokenSetAuthErrorSummary,
	TokenSetAuthEvent,
	TokenSetAuthEventPayload,
} from "./events/auth-events";
export {
	createTokenSetAuthEvent,
	summarizeAuthError,
	TokenSetAuthEventType,
} from "./events/auth-events";
export type {
	CreateTokenSetPersistenceEventOptions,
	TokenSetPersistenceEvent,
	TokenSetPersistenceEventPayload,
} from "./events/persistence-events";
export {
	createTokenSetPersistenceEvent,
	TokenSetPersistenceAction,
	TokenSetPersistenceEventType,
	TokenSetPersistenceReason,
} from "./events/persistence-events";
export { mergeTokenDelta } from "./token/ops";
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
