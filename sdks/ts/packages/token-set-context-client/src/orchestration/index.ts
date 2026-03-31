// --- Generic Token Orchestration Layer ---
//
// This module is the primary entry point for the protocol-agnostic token
// orchestration sublayer of @securitydept/token-set-context-client.
// It is also accessible as a dedicated subpath import:
//
//   import { ... } from "@securitydept/token-set-context-client/orchestration"
//
// Contents: token snapshot types, delta merge, bearer projection, persistence,
// and authorized transport — all without any token-set sealed flow semantics.
//
// Current status: PUBLIC subpath within token-set-context-client (same npm package).
// Stability: provisional (additive, freezing-in-progress; not yet promoted to stable).
// Not a separate npm package — extraction path is clear if warranted later.

export type {
	BearerHeaderProvider,
	CreateAuthorizedTransportOptions,
} from "./auth-transport";
export { createAuthorizedTransport } from "./auth-transport";
// Controller: thin lifecycle layer that composes state + persistence + transport.
export type {
	ApplyDeltaOptions,
	AuthMaterialController,
	AuthMaterialState,
	CreateAuthMaterialControllerOptions,
} from "./controller";
export { createAuthMaterialController } from "./controller";
export type { AuthStatePersistence } from "./persistence";
export { createAuthStatePersistence } from "./persistence";
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
