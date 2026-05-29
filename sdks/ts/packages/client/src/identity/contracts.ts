export interface IdentityPrincipal {
	subject: string;
	displayName: string;
	picture?: string;
	issuer?: string;
	claims?: Record<string, unknown>;
}

export interface ProjectIdentityPrincipalOptions {
	principal?: IdentityPrincipal | null;
	fallbackDisplayName?: string;
	fallbackSubject?: string;
	fallbackIssuer?: string;
	fallbackClaims?: Record<string, unknown>;
}
