// Token-set React adapter
//
// Canonical import path:
//   import { ... } from "@securitydept/token-set-context-client-react"
//
// Provides React callback helpers, runtime/provider factories for injector
// composition, and React-specific type re-exports. No domain-specific React
// Context or Provider APIs are exposed from this package.
//
// Stability: provisional (React adapter)

import type {
	AuthStateSnapshot,
	BackendOidcModeClientConfig,
} from "@securitydept/token-set-context-client/backend-oidc-mode";
import { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";

export {
	type ClientFilter,
	ClientInitializationPriority,
	type ClientKeySelector,
	type ClientMeta,
	type ClientQueryOptions,
	type ClientReadinessState,
} from "@securitydept/token-set-context-client/registry";
export {
	provideTokenSetCallbackResumeController,
	TOKEN_SET_CALLBACK_RESUME_CONTROLLER,
} from "./callback-resume-service";
// Multi-client registry-based adapter surface.
export type {
	OidcCallbackClient,
	OidcModeClient,
	OidcRedirectLoginClient,
	OidcRedirectLoginOptions,
	TokenSetBackendOidcClient,
	TokenSetClientEntry,
	TokenSetOidcRedirectLoginClient,
	TokenSetReactClient,
} from "./contracts";
export {
	provideTokenSetAuthRegistry,
	type ReactRegistry,
	TOKEN_SET_AUTH_REGISTRY,
} from "./token-set-auth-registry";
export { TokenSetAuthService } from "./token-set-auth-service";
export {
	type CallbackResumeErrorDetails,
	type CallbackResumeState,
	CallbackResumeStatus,
	readCallbackResumeErrorDetails,
	TokenSetCallbackComponent,
	type TokenSetCallbackComponentProps,
	type UseTokenSetCallbackResumeOptions,
	useTokenSetCallbackResume,
} from "./token-set-callback";
export type { AuthStateSnapshot, BackendOidcModeClientConfig };
export { BackendOidcModeClient };
