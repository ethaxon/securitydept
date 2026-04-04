// Backend OIDC Mediated Mode — canonical subpath entry
//
// Canonical import path:
//   import { BackendOidcMediatedModeClient } from "@securitydept/token-set-context-client/backend-oidc-mediated-mode"
//
// Companion subpaths:
//   @securitydept/token-set-context-client/backend-oidc-mediated-mode/web   — browser adapter
//   @securitydept/token-set-context-client/backend-oidc-mediated-mode/react — React adapter
//   @securitydept/token-set-context-client/orchestration   — shared token-lifecycle substrate
//
// Stability: stable (browser-owned mediated flow v1 contract)

export type { CreateBackendOidcMediatedModeAuthorizedTransportOptions } from "./auth-transport";
export { createBackendOidcMediatedModeAuthorizedTransport } from "./auth-transport";
export { BackendOidcMediatedModeClient } from "./client";
// v1 aliases re-exported for adopter convenience
export type {
	AuthenticatedPrincipal,
	AuthenticationSource,
	AuthenticationSourceKind as AuthenticationSourceKindType,
	AuthStateDelta,
	AuthStateSnapshot,
	BackendOidcMediatedModeAuthorizeQuery,
	BackendOidcMediatedModeClientConfig,
} from "./types";
export {
	AuthenticationSourceKind,
	BackendOidcMediatedModeContextSource,
	BackendOidcMediatedModeStateRestoreSourceKind,
} from "./types";
