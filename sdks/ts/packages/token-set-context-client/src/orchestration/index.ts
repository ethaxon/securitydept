// --- Generic Token Orchestration Layer ---
//
// This module is the primary entry point for the protocol-agnostic token
// orchestration sublayer of @securitydept/token-set-context-client.
// It is also accessible as a dedicated subpath import:
//
//   import { ... } from "@securitydept/token-set-context-client/orchestration"
//
// Contents: token snapshot types, delta merge, bearer projection, and
// persistence — all without any OIDC-mediated sealed flow semantics.
//
// NOTE: The shared auth requirement orchestration primitives (requirement planner,
// route orchestrator) have moved to @securitydept/client.
// Migration: see docs/en/110-TS_SDK_MIGRATIONS.md
//
// Current status: PUBLIC subpath within token-set-context-client (same npm package).
// Stability: provisional (additive, freezing-in-progress; not yet promoted to stable).
// Not a separate npm package — extraction path is clear if warranted later.

export {
	type ClientErrorAttributes,
	type ClientErrorRecovery,
	describeError,
	type ErrorAttributes,
	type NativeErrorAttributes,
	type UnknownErrorAttributes,
} from "@securitydept/client";
export { BaseOidcModeClient, PersistPolicy } from "./client/base-client";
// Base client: shared lifecycle infrastructure for mode-specific clients.
export {
	type BaseOidcModeClientDefaultOptions,
	type BaseOidcModeClientOptions,
	type OidcModeClientConfigBase,
	type OidcPopupLoginOptions,
	type OidcPopupLoginResult,
	type OidcRedirectLoginOptions,
	StateRestoreSourceKind,
	type TokenSetAuthOperationSignals,
} from "./client/types";
export {
	type AuthWorkflowRuntimeOptions,
	type AuthWorkflowSource as TokenSetAuthWorkflowSource,
	type AuthWorkflowSourcesOptions,
	type BuiltinAuthWorkflowSourceOption as BuiltinWorkflowSourceOption,
	createPageResumeWorkflowSource,
	createRefreshTimerWorkflowSource,
	type PageResumeWorkflowSourceOptions,
} from "./client/workflows/source";
export {
	type CreateTokenSetAuthEventOptions,
	createTokenSetAuthEvent,
	summarizeAuthError,
	type TokenSetAuthErrorSummary,
	type TokenSetAuthEvent,
	type TokenSetAuthEventPayload,
	type TokenSetAuthEventPayloadBase,
	type TokenSetAuthEventPayloadBuilder,
	type TokenSetAuthEventPayloadInput,
	TokenSetAuthEventType,
	type TokenSetAuthRefreshEventPayload,
} from "./events/auth-events";
export * from "./token/freshness";
export { mergeTokenDelta } from "./token/ops";
export {
	type AuthDelta,
	type AuthMetadataDelta,
	type AuthMetadataSnapshot,
	type AuthPrincipal,
	type AuthSnapshot,
	type AuthSource,
	AuthSourceKind,
	type TokenDelta,
	type TokenSnapshot,
} from "./token/types";
