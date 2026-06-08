import { BackendOidcModeCallbackRuntime } from "@/auth/token-set/backend-mode-callback";
import { AuthContextMode } from "./model";
import { useAuthMode } from "./react";

export function AuthRuntime() {
	const { mode } = useAuthMode();
	return mode === AuthContextMode.TokenSetBackend ? (
		<BackendOidcModeCallbackRuntime />
	) : null;
}
