// Frontend OIDC Mode — cross-boundary contracts
//
// These types define the cross-boundary contracts between the frontend OIDC
// browser client and backend config projection sources.

import { type IdentityPrincipal } from "@securitydept/client";
import { type FrontendOidcModeClientConfig } from "../client/types";

export type FrontendOidcModeClaimsCheckScript = {
	type: "inline";
	content: string;
};

export interface FrontendOidcModeClaimsCheckSuccessResult {
	success: true;
	displayName: string;
	picture?: string;
	claims: Record<string, unknown>;
}

export interface FrontendOidcModeClaimsCheckFailureResult {
	success: false;
	error?: string;
	claims?: unknown;
}

export type FrontendOidcModeClaimsCheckResult =
	| FrontendOidcModeClaimsCheckSuccessResult
	| FrontendOidcModeClaimsCheckFailureResult;

export interface FrontendOidcModeConfigProjection {
	wellKnownUrl?: string;
	issuerUrl?: string;
	jwksUri?: string;
	metadataRefreshInterval?: string;
	jwksRefreshInterval?: string;
	authorizationEndpoint?: string;
	tokenEndpoint?: string;
	userinfoEndpoint?: string;
	revocationEndpoint?: string;
	tokenEndpointAuthMethodsSupported?: string[];
	idTokenSigningAlgValuesSupported?: string[];
	userinfoSigningAlgValuesSupported?: string[];
	clientId: string;
	clientSecret?: string;
	scopes?: string[];
	requiredScopes?: string[];
	redirectUrl: string;
	pkceEnabled?: boolean;
	claimsCheckScript?: FrontendOidcModeClaimsCheckScript;
	generatedAt: number;
}

export function configProjectionToClientConfig(
	projection: FrontendOidcModeConfigProjection,
	overrides?: Partial<
		Pick<
			FrontendOidcModeClientConfig,
			"redirectUri" | "defaultPostAuthRedirectUri"
		>
	>,
): FrontendOidcModeClientConfig {
	const issuer =
		projection.issuerUrl ??
		projection.wellKnownUrl?.replace(
			/\/\.well-known\/openid-configuration\/?$/,
			"",
		) ??
		"";

	if (projection.clientSecret) {
		console.warn(
			"[securitydept] SECURITY WARNING: the server exposed client_secret to the " +
				"browser via UnsafeFrontendClientSecret capability. This is a security " +
				"anti-pattern. Contact your administrator.",
		);
	}

	return {
		issuer,
		clientId: projection.clientId,
		scopes: projection.scopes,
		redirectUri: overrides?.redirectUri ?? projection.redirectUrl,
		defaultPostAuthRedirectUri: overrides?.defaultPostAuthRedirectUri,
		authorizationEndpoint: projection.authorizationEndpoint,
		tokenEndpoint: projection.tokenEndpoint,
		userinfoEndpoint: projection.userinfoEndpoint,
		revocationEndpoint: projection.revocationEndpoint,
		pkceEnabled: projection.pkceEnabled,
		clientSecret: projection.clientSecret,
		requiredScopes: projection.requiredScopes,
		claimsCheckScript: projection.claimsCheckScript,
		jwksUri: projection.jwksUri,
		metadataRefreshInterval: projection.metadataRefreshInterval,
		jwksRefreshInterval: projection.jwksRefreshInterval,
		tokenEndpointAuthMethodsSupported:
			projection.tokenEndpointAuthMethodsSupported,
		idTokenSigningAlgValuesSupported:
			projection.idTokenSigningAlgValuesSupported,
		userinfoSigningAlgValuesSupported:
			projection.userinfoSigningAlgValuesSupported,
	};
}

export interface FrontendOidcModeUserInfoResponse extends IdentityPrincipal {
	subject: string;
	displayName: string;
	picture?: string;
	email?: string;
	emailVerified?: boolean;
	claims?: Record<string, unknown>;
}
