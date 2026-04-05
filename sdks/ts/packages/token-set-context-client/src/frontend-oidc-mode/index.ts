// Frontend OIDC Mode — canonical subpath entry
//
// Canonical import path:
//   import { ... } from "@securitydept/token-set-context-client/frontend-oidc-mode"
//
// This subpath provides two layers:
//
// 1. Browser runtime: the oauth4webapi-based OIDC client
//    (FrontendOidcModeClient, FrontendOidcModeClientConfig, etc.)
//
// 2. Cross-boundary contracts: types aligned with Rust FrontendOidcMode*
//    (FrontendOidcModeConfigProjection, FrontendOidcModeIntegrationRequirement,
//     FrontendOidcModeTokenMaterial)
//
// Plus adapters bridging browser runtime results into the shared
// orchestration substrate and cross-boundary contract material.
//
// Stability: provisional (mode-aligned surface)

// --- Browser runtime ---

export type { FrontendOidcModeClient } from "./client";
export { createFrontendOidcModeClient } from "./client";
export type {
	FrontendOidcModeAuthorizeParams,
	FrontendOidcModeAuthorizeResult,
	FrontendOidcModeClientConfig,
	FrontendOidcModeTokenResult,
} from "./types";

// --- Cross-boundary contracts (aligned with Rust FrontendOidcMode*) ---

export type {
	FrontendOidcModeConfigProjection,
	FrontendOidcModeIntegrationRequirement,
	FrontendOidcModeTokenMaterial,
} from "./contracts";

// --- Adapters: projection → client config, result → orchestration ---

export {
	configProjectionToClientConfig,
	tokenResultToAuthSnapshot,
	tokenResultToTokenMaterial,
} from "./contracts";
