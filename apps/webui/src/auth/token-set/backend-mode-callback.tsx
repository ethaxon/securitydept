import { useTokenSetBackendCallback } from "@securitydept/token-set-context-client-react";

export function BackendOidcModeCallbackRuntime() {
	useTokenSetBackendCallback();
	return null;
}
