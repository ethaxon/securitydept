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

export { describeError, type ErrorSummary } from "@securitydept/client";
export { BaseOidcModeClient, PersistPolicy } from "./client/base-client";
export {
	TokenSetAuthorizationErrorCode,
	TokenSetAuthorizationErrorSource,
	TokenSetAuthorizationRevocationError,
	TokenSetAuthorizationRevocationReason,
} from "./client/error";
export { TokenSetPersistenceErrorCode } from "./client/persistence";
// Base client: shared lifecycle infrastructure for mode-specific clients.
export {
	type BaseOidcModeClientDefaultOptions,
	type BaseOidcModeClientOptions,
	OidcModeCallbackHandlingKind,
	type OidcModeCallbackHandlingResult,
	type OidcModeCallbackInputResolver,
	type OidcModeCallbackInputResolverOptions,
	type OidcModeCallbackStateTrait,
	type OidcModeClientConfigBase,
	type TokenSetAuthOperationSignals,
	type TokenSetAuthStateOperationOptions,
	type TokenSetOidcPopupLoginOptions,
	type TokenSetOidcPopupLoginResult,
	type TokenSetOidcRedirectLoginOptions,
	TokenSetStateRestoreSourceKind,
} from "./client/types";
export {
	createTokenSetPageResumeWorkflowSource,
	createTokenSetRefreshTimerWorkflowSource,
	type TokenSetAuthWorkflowRuntimeOptions,
	type TokenSetAuthWorkflowSource,
	type TokenSetAuthWorkflowSourcesOptions,
	type TokenSetBuiltinAuthWorkflowSourceOption,
	type TokenSetPageResumeWorkflowSourceOptions,
} from "./client/workflows/source";
export {
	type CreateTokenSetAuthEventOptions,
	createTokenSetAuthEvent,
	type TokenSetAuthEvent,
	type TokenSetAuthEventPayload,
	type TokenSetAuthEventPayloadBase,
	type TokenSetAuthEventPayloadBuilder,
	type TokenSetAuthEventPayloadInput,
	TokenSetAuthEventType,
	type TokenSetAuthRefreshEventPayload,
} from "./events/auth-events";
export * from "./token/freshness";
export { mergeTokenSetTokenDelta } from "./token/ops";
export {
	type TokenSetAuthDelta,
	type TokenSetAuthMetadataDelta,
	type TokenSetAuthMetadataSnapshot,
	type TokenSetAuthPrincipal,
	type TokenSetAuthSnapshot,
	type TokenSetAuthSource,
	TokenSetAuthSourceKind,
	type TokenSetTokenDelta,
	type TokenSetTokenSnapshot,
} from "./token/types";
