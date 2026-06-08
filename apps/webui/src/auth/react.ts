import {
	useResourceValue,
	useSecuritydeptContext,
	useSignal,
} from "@securitydept/client-react";
import { AUTH_SERVICE, type AuthService } from "./auth.service";
import { type AuthContextMode, type WebuiAuthUser } from "./model";

export interface AuthModeState {
	readonly storedMode: AuthContextMode | null;
	readonly mode: AuthContextMode;
}

export function useAuthService(): AuthService {
	return useSecuritydeptContext().get(AUTH_SERVICE);
}

export function useAuthMode(): AuthModeState {
	const authService = useAuthService();
	const mode = useSignal(authService.mode);
	const storedMode = authService.getMode();

	return {
		storedMode,
		mode,
	};
}

export function useAuthUser(): WebuiAuthUser {
	return useResourceValue(useAuthService().authUser);
}
