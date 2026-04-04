// Backend OIDC Pure Mode — Frontend-facing Surface
//
// Canonical import path:
//   import { ... } from "@securitydept/token-set-context-client/backend-oidc-pure-mode"
//
// This subpath represents the frontend-facing surface of the backend-oidc-pure
// mode. The backend handles the full OIDC flow; the frontend uses
// ./orchestration for generic token lifecycle management.
//
// Current status: formal surface established. Runtime content is minimal:
// the frontend side of backend-oidc-pure typically only needs the
// ./orchestration substrate (applyDelta, persistence, transport).
//
// This entry exists to formalize the mode boundary. As backend-oidc-pure
// develops frontend-specific contracts (config projection, requirement/guard
// specs, etc.), they will be added here.
//
// Stability: provisional

export type {
	ApplyDeltaOptions,
	AuthMaterialController,
	AuthMaterialState,
	AuthSnapshot,
	AuthSource,
	AuthStatePersistence,
	BearerHeaderProvider,
	CreateAuthMaterialControllerOptions,
	CreateAuthorizedTransportOptions,
	TokenDelta,
	TokenSnapshot,
} from "../orchestration/index";
// Placeholder: re-export the orchestration substrate as the primary
// frontend interface for backend-oidc-pure mode consumers.
export {
	AuthSourceKind,
	bearerHeader,
	createAuthMaterialController,
	createAuthorizedTransport,
	createAuthStatePersistence,
	mergeTokenDelta,
} from "../orchestration/index";
