// Frontend Pure OIDC Client — public subpath entry
//
// This is the entry point for the first scenario pillar of
// token-set-context-client: standard browser OIDC Authorization Code + PKCE.
//
// Official base: oauth4webapi (low-level protocol building blocks)
// Comparison cases: oidc-client-ts, future angular-auth-oidc-client
//
// Stability: experimental (first slice — not yet a stable public surface)
//
// Usage:
//   import { createOidcClient } from "@securitydept/token-set-context-client/oidc";

export type { OidcClient } from "./client";
export { createOidcClient } from "./client";
export type {
	AuthorizeParams,
	AuthorizeResult,
	OidcClientConfig,
	OidcTokenResult,
} from "./types";
