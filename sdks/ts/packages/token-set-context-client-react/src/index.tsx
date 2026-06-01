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

import {
	BackendOidcModeClient,
	type BackendOidcModeClientConfig,
} from "@securitydept/token-set-context-client/backend-oidc-mode";
import { type TokenSetAuthSnapshot } from "@securitydept/token-set-context-client/orchestration";

export {
	type TokenSetClientFilter,
	TokenSetClientInitializationMode,
	type TokenSetClientMeta,
	type TokenSetClientQueryOptions,
	type TokenSetClientSelector,
} from "@securitydept/token-set-context-client/registry";
export {
	createTokenSetCallbackResumeController,
	provideTokenSetCallbackResumeController,
	TOKEN_SET_CALLBACK_RESUME_CONTROLLER,
} from "./callback-resume-service";
// Multi-client registry-based adapter surface.
export {
	type TokenSetBackendOidcClient,
	type TokenSetClientEntry,
	type TokenSetReactClient,
} from "./contracts";
export {
	provideTokenSetAuthRegistry,
	type ReactRegistry,
	TOKEN_SET_AUTH_REGISTRY,
} from "./token-set-auth-registry";
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
export {
	BackendOidcModeClient,
	type BackendOidcModeClientConfig,
	type TokenSetAuthSnapshot,
};
