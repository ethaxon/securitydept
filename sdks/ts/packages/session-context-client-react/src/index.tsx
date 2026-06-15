import { useSecuritydeptContext } from "@securitydept/client-react";
import {
	SESSION_CONTEXT_CLIENT,
	type SessionContextClient,
} from "@securitydept/session-context-client";

export function useSessionContextClient(): SessionContextClient {
	return useSecuritydeptContext().get(SESSION_CONTEXT_CLIENT);
}
