import { SecuritydeptInjectionToken } from "@securitydept/client";
import { type SessionContextClient } from "./client";
import { type SessionContextClientConfig } from "./types";

export const SESSION_CONTEXT_CLIENT =
	new SecuritydeptInjectionToken<SessionContextClient>(
		"SESSION_CONTEXT_CLIENT",
	);

export const SESSION_CONTEXT_CLIENT_CONFIG =
	new SecuritydeptInjectionToken<SessionContextClientConfig>(
		"SESSION_CONTEXT_CLIENT_CONFIG",
	);
