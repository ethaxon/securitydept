import {
	useResourceValue,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import { AUTH_SERVICE, type AuthService } from "./auth.service";
import { type AuthContextMode, type WebuiAuthUser } from "./model";

export function useAuthService(): AuthService {
	return useSecuritydeptContext().get(AUTH_SERVICE);
}

export function useAuthMode(): AuthContextMode | null {
	return useResourceValue(useAuthService().mode);
}

export function useAuthUser(): WebuiAuthUser {
	return useResourceValue(useAuthService().authUser);
}
