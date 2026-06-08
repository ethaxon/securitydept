import { useTokenSetBackendCallbackController } from "@securitydept/token-set-context-client-react";
import { TOKEN_SET_BACKEND_MODE_CONFIG } from "./config";

const BACKEND_MODE_CLIENT_QUERY = {
	clientKey: TOKEN_SET_BACKEND_MODE_CONFIG.clientKey,
} as const;

export function BackendOidcModeCallbackRuntime() {
	useTokenSetBackendCallbackController({
		clientQuery: BACKEND_MODE_CLIENT_QUERY,
	});
	return null;
}
