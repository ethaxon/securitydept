import {
	useReplaySignalValue,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import { useSyncExternalStore } from "react";
import {
	AUTH_SERVICE,
	AuthContextMode,
	type AuthService,
	type WebuiAuthUser,
} from "./authService";

export interface AuthModeState {
	readonly storedMode: AuthContextMode | null;
	readonly mode: AuthContextMode;
}

export function useAuthService(): AuthService {
	return useSecuritydeptContext().get(AUTH_SERVICE);
}

export function useAuthMode(): AuthModeState {
	const authService = useAuthService();
	const storedMode = useSyncExternalStore(
		(listener) => authService.subscribeMode(listener),
		() => authService.getMode(),
		() => authService.getMode(),
	);

	return {
		storedMode,
		mode: storedMode ?? AuthContextMode.Session,
	};
}

export function useAuthUser(): WebuiAuthUser {
	return useReplaySignalValue(useAuthService().authUser);
}
