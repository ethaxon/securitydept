// Token-Set Browser Adapter — canonical subpath entry
//
// Previously at ./web. Now at ./token-set/web to reflect the family structure.
// The old ./web path remains as a backward-compatible bridge.
//
//   import { createTokenSetBrowserClient } from "@securitydept/token-set-context-client/token-set/web";
//
// Stability: stable (v1, browser-owned token-set contract)

export type {
	CreateTokenSetBrowserClientOptions,
	HistoryLike,
	LocationLike,
	TokenSetBootstrapResult,
} from "../../web/token-set-browser";
export {
	bootstrapTokenSetClient,
	captureTokenSetCallbackFragmentFromUrl,
	createTokenSetBrowserClient,
	createTokenSetCallbackFragmentStore,
	resetTokenSetBrowserState,
	resolveTokenSetAuthorizeUrl,
	resolveTokenSetReturnUri,
	TokenSetBootstrapSource,
} from "../../web/token-set-browser";
