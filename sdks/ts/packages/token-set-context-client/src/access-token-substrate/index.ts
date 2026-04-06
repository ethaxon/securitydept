// Access-token substrate — canonical subpath entry
//
// Canonical import path:
//   import { ... } from "@securitydept/token-set-context-client/access-token-substrate"
//
// This subpath provides the substrate-level capability contracts that are
// shared across all token-set-context modes. Substrate capabilities like
// token propagation are NOT mode-specific — they apply to any access token
// regardless of whether it was produced by frontend-oidc or backend-oidc.
//
// Stability: canonical (formal substrate surface v1)

// --- Substrate capability vocabulary ---

export type { TokenPropagation as TokenPropagationType } from "./contracts";
export { TokenPropagation } from "./contracts";

// --- Substrate integration info ---

export type { AccessTokenSubstrateIntegrationInfo } from "./contracts";
