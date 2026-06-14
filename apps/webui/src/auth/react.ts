import { type ResourceSnapshot } from "@securitydept/client";
import {
	useResourceSnapshot,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import { AUTH_SERVICE, type AuthService } from "./auth.service";
import { type AuthContextMode, type WebuiAuthUser } from "./model";

export function useAuthService(): AuthService {
	return useSecuritydeptContext().get(AUTH_SERVICE);
}

export function useAuthMode(): ResourceSnapshot<AuthContextMode | null> {
	return useResourceSnapshot(useAuthService().mode);
}

export function useAuthUser(): ResourceSnapshot<WebuiAuthUser> {
	return useResourceSnapshot(useAuthService().authUser);
}
