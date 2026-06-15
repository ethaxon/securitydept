import {
	BASIC_AUTH_CONTEXT_CLIENT,
	type BasicAuthContextClient,
} from "@securitydept/basic-auth-context-client";
import { useSecuritydeptContext } from "@securitydept/client-react";

export function useBasicAuthContextClient(): BasicAuthContextClient {
	return useSecuritydeptContext().get(BASIC_AUTH_CONTEXT_CLIENT);
}
