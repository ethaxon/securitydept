import { SecuritydeptInjectionToken } from "@securitydept/client";
import { type OidcModeCallbackResolutionOptions } from "../orchestration/client/types";
import { type FrontendOidcModeClient } from "./client/client";
import { type FrontendOidcModeClientConfig } from "./client/types";
import { type FrontendOidcModeCallbackInput } from "./contracts/callback";

export type FrontendOidcModeClientInjectionOptions = {
	readonly config: FrontendOidcModeClientConfig;
} & OidcModeCallbackResolutionOptions<FrontendOidcModeCallbackInput>;

export const FRONTEND_OIDC_MODE_CLIENT =
	new SecuritydeptInjectionToken<FrontendOidcModeClient>(
		"FRONTEND_OIDC_MODE_CLIENT",
	);

export const FRONTEND_OIDC_MODE_CLIENT_OPTIONS =
	new SecuritydeptInjectionToken<FrontendOidcModeClientInjectionOptions>(
		"FRONTEND_OIDC_MODE_CLIENT_OPTIONS",
	);
