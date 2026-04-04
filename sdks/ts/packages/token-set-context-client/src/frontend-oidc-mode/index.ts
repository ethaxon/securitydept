// Frontend OIDC Mode — canonical subpath entry
//
// Canonical import path:
//   import { createFrontendOidcModeClient } from "@securitydept/token-set-context-client/frontend-oidc-mode"
//
// Stability: experimental (first slice)
//   import { createFrontendOidcModeClient } from "@securitydept/token-set-context-client/frontend-oidc-mode";

export type { FrontendOidcModeClient } from "./client";
export { createFrontendOidcModeClient } from "./client";
export type {
	FrontendOidcModeAuthorizeParams,
	FrontendOidcModeAuthorizeResult,
	FrontendOidcModeClientConfig,
	FrontendOidcModeTokenResult,
} from "./types";
