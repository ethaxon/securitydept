import { SecuritydeptInjectionToken } from "@securitydept/client";
import { type BasicAuthContextClient } from "./client";
import { type BasicAuthContextClientConfig } from "./types";

export const BASIC_AUTH_CONTEXT_CLIENT =
	new SecuritydeptInjectionToken<BasicAuthContextClient>(
		"BASIC_AUTH_CONTEXT_CLIENT",
	);

export const BASIC_AUTH_CONTEXT_CLIENT_CONFIG =
	new SecuritydeptInjectionToken<BasicAuthContextClientConfig>(
		"BASIC_AUTH_CONTEXT_CLIENT_CONFIG",
	);
