export type JwtAudienceClaim = string | readonly string[];

export interface JwtClaimsSet extends Record<string, unknown> {
	iss?: string;
	sub?: string;
	aud?: JwtAudienceClaim;
	exp?: number;
	nbf?: number;
	iat?: number;
	jti?: string;
}

export interface DecodeJwtPayloadOptions {
	/**
	 * Optional label used in error messages. It does not affect parsing.
	 */
	label?: string;
}
