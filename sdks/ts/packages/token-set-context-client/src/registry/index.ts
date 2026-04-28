// Shared token-set auth registry — canonical subpath entry
//
// Canonical import path:
//   import { ... } from "@securitydept/token-set-context-client/registry"
//
// This subpath exports a framework-neutral registry core that both the
// Angular adapter (@securitydept/token-set-context-client-angular) and the
// React adapter (@securitydept/token-set-context-client-react) build on.
//
// The registry is responsible for multi-client:
//   - Registration with sync-or-async clientFactory
//   - Readiness tracking (ClientReadinessState state machine)
//   - Priority-aware materialization (primary eager / lazy idle warmup)
//   - preload / whenReady / idleWarmup / reset lifecycle verbs
//   - Multi-axis discrimination (urlPatterns / callbackPath /
//     requirementKind / providerFamily) with AND / OR filter queries
//
// Stability: provisional (shared registry surface introduced in iteration 110)

// Re-export ClientReadinessState (both the const-enum value and its type).
export { ClientReadinessState } from "../frontend-oidc-mode/config-source";
export {
	createTokenSetAuthRegistry,
	TokenSetAuthRegistry,
} from "./client-registry";
export { isOidcCallback } from "./oidc-callback-url";
export type {
	ClientFilter,
	ClientKeySelector,
	ClientMeta,
	ClientQueryOptions,
	CreateTokenSetAuthRegistryOptions,
	EnsureRegistryAuthForResourceOptions,
	OidcCallbackClient,
	OidcModeClient,
	TokenSetClientEntry,
} from "./types";
export { ClientInitializationPriority } from "./types";
