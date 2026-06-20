import {
	ClientError,
	ClientErrorKind,
	type ResourceSnapshot,
	UserRecovery,
} from "@securitydept/client";
import {
	useResourceSnapshot,
	useSecuritydeptContext,
	useSuspenseResourceValue,
} from "@securitydept/client-react";
import { AUTH_SERVICE, type AuthService } from "./auth.service";
import { type AuthContextMode, type WebuiAuthUser } from "./model";

export function useAuthService(): AuthService {
	return useSecuritydeptContext().get(AUTH_SERVICE);
}

export function useAuthMode(): ResourceSnapshot<AuthContextMode | null> {
	return useResourceSnapshot(useAuthService().mode);
}

export function useAuthUserValue(): WebuiAuthUser | null {
	return useSuspenseResourceValue(useAuthService().authUser);
}

export function useAuthenticatedAuthMode(): AuthContextMode {
	const mode = useSuspenseResourceValue(useAuthService().mode);
	if (mode === null) {
		throw new ClientError({
			kind: ClientErrorKind.Unauthenticated,
			code: "webui.auth_mode.not_selected",
			message: "An authenticated view requires a selected authentication mode.",
			source: "webui.auth.react",
			recovery: UserRecovery.Reauthenticate,
		});
	}
	return mode;
}

export function useAuthenticatedAuthUser(): WebuiAuthUser {
	const user = useSuspenseResourceValue(useAuthService().authUser);
	if (user === null) {
		throw new ClientError({
			kind: ClientErrorKind.Unauthenticated,
			code: "webui.auth_user.unavailable",
			message: "An authenticated view requires a resolved authentication user.",
			source: "webui.auth.react",
			recovery: UserRecovery.Reauthenticate,
		});
	}
	return user;
}
