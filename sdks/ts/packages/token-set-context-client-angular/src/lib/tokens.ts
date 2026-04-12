import { InjectionToken } from "@angular/core";
import type { TokenSetAuthRegistry } from "./token-set-auth-registry";

/** InjectionToken for the multi-client auth registry. */
export const TOKEN_SET_AUTH_REGISTRY = new InjectionToken<TokenSetAuthRegistry>(
	"TOKEN_SET_AUTH_REGISTRY",
);
