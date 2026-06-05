export const TokenSetAuthorizationRevocationReason = {
	InvalidGrant: "invalid_grant",
	InvalidToken: "invalid_token",
} as const;

export type TokenSetAuthorizationRevocationReason =
	(typeof TokenSetAuthorizationRevocationReason)[keyof typeof TokenSetAuthorizationRevocationReason];

export class TokenSetAuthorizationRevocationError extends Error {
	override readonly name = "TokenSetAuthorizationRevocationError";

	constructor(
		readonly reason: TokenSetAuthorizationRevocationReason,
		options?: { cause?: unknown },
	) {
		super(`Token-set authorization was revoked: ${reason}`, options);
	}
}
