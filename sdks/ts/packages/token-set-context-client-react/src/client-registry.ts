import { useSecuritydeptContext } from "@securitydept/client-react";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	TOKEN_SET_CLIENT_REGISTRY,
	type TokenSetClientRegistry,
} from "@securitydept/token-set-context-client/registry";

export function useTokenSetClientRegistry(): TokenSetClientRegistry<BaseOidcModeClient> {
	return useSecuritydeptContext().get(TOKEN_SET_CLIENT_REGISTRY);
}
