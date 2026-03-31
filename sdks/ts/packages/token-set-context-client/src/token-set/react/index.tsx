// Token-Set React Adapter — canonical subpath entry
//
// Previously at ./react. Now at ./token-set/react to reflect the family structure.
// The old ./react path remains as a backward-compatible bridge.
//
//   import { TokenSetContextProvider } from "@securitydept/token-set-context-client/token-set/react";
//
// Stability: stable (v1, browser-owned token-set contract)

export type { TokenSetContextProviderProps } from "../../react/index";
export {
	TokenSetContextProvider,
	useAccessToken,
	useAuthState,
	useTokenSetContext,
} from "../../react/index";
