import { SecuritydeptInjectionToken } from "@securitydept/client";
import { type OidcModeCallbackResolutionOptions } from "../orchestration/client/types";
import { type BackendOidcModeClient } from "./client/client";
import { type BackendOidcModeClientConfig } from "./client/types";
import { type BackendOidcModeCallbackInput } from "./contracts/callback";

export type BackendOidcModeClientInjectionOptions = {
	readonly config: BackendOidcModeClientConfig;
	readonly callbackRoutingKey?: string;
} & OidcModeCallbackResolutionOptions<BackendOidcModeCallbackInput>;

export const BACKEND_OIDC_MODE_CLIENT =
	new SecuritydeptInjectionToken<BackendOidcModeClient>(
		"BACKEND_OIDC_MODE_CLIENT",
	);

export const BACKEND_OIDC_MODE_CLIENT_OPTIONS =
	new SecuritydeptInjectionToken<BackendOidcModeClientInjectionOptions>(
		"BACKEND_OIDC_MODE_CLIENT_OPTIONS",
	);
