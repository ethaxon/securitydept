import { type BaseTransportTrait } from "@securitydept/client";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import { type DashboardUser } from "@/dashboard/principal";

export const AuthContextMode = {
	Session: "session",
	TokenSetBackend: "token-set-backend-mode",
	TokenSetFrontend: "token-set-frontend-mode",
	Basic: "basic",
} as const;

export type AuthContextMode =
	(typeof AuthContextMode)[keyof typeof AuthContextMode];

export const WebuiAuthUserKind = {
	Session: "session",
	Basic: "basic",
	TokenSetBackendOidcMode: "token-set-backend-oidc-mode",
	TokenSetFrontendOidcMode: "token-set-frontend-oidc-mode",
} as const;

export type WebuiAuthUserKind =
	(typeof WebuiAuthUserKind)[keyof typeof WebuiAuthUserKind];

export interface WebuiSessionAuthUser {
	readonly type: typeof WebuiAuthUserKind.Session;
	readonly userInfo: DashboardUser;
}

export interface WebuiBasicAuthUser {
	readonly type: typeof WebuiAuthUserKind.Basic;
	readonly userInfo: DashboardUser;
}

export interface WebuiTokenSetBackendOidcModeAuthUser {
	readonly type: typeof WebuiAuthUserKind.TokenSetBackendOidcMode;
	readonly userInfo: DashboardUser;
}

export interface WebuiTokenSetFrontendOidcModeAuthUser {
	readonly type: typeof WebuiAuthUserKind.TokenSetFrontendOidcMode;
	readonly userInfo: DashboardUser;
}

export type WebuiAuthUser =
	| WebuiSessionAuthUser
	| WebuiBasicAuthUser
	| WebuiTokenSetBackendOidcModeAuthUser
	| WebuiTokenSetFrontendOidcModeAuthUser;

export interface DashboardCookieAccess {
	readonly kind: "cookie";
	readonly mode: typeof AuthContextMode.Session | typeof AuthContextMode.Basic;
	readonly basePath: "" | "/basic";
	readonly transport: BaseTransportTrait;
}

export interface DashboardTokenSetAccess {
	readonly kind: "token-set";
	readonly mode:
		| typeof AuthContextMode.TokenSetBackend
		| typeof AuthContextMode.TokenSetFrontend;
	readonly clientKey: string;
	readonly client: BaseOidcModeClient;
	readonly transport: BaseTransportTrait;
}

export type DashboardAccess = DashboardCookieAccess | DashboardTokenSetAccess;

export interface AuthLoginOptions {
	readonly mode: AuthContextMode;
	readonly postAuthRedirectUri?: string;
}
