import {
	ClientError,
	ClientErrorKind,
	type SpanTrait,
	UserRecovery,
} from "@securitydept/client";

export const TokenSetAuthorizationRevocationReason = {
	InvalidGrant: "invalid_grant",
	InvalidToken: "invalid_token",
} as const;

export type TokenSetAuthorizationRevocationReason =
	(typeof TokenSetAuthorizationRevocationReason)[keyof typeof TokenSetAuthorizationRevocationReason];

export const TokenSetAuthorizationErrorCode = {
	OperationFailed: "token_set.authorization.operation_failed",
	InvalidGrant: "token_set.authorization.invalid_grant",
	InvalidToken: "token_set.authorization.invalid_token",
} as const;

export type TokenSetAuthorizationErrorCode =
	(typeof TokenSetAuthorizationErrorCode)[keyof typeof TokenSetAuthorizationErrorCode];

export const TokenSetAuthorizationErrorSource = "token_set.authorization";

export function clientErrorFromTokenSetAuthorizationError(
	error: unknown,
	options: { span: SpanTrait | undefined },
): ClientError {
	return ClientError.fromUnknown(error, {
		code: TokenSetAuthorizationErrorCode.OperationFailed,
		message: "The token-set authorization operation failed unexpectedly",
		source: TokenSetAuthorizationErrorSource,
		span: options.span,
	});
}

export class TokenSetAuthorizationRevocationError extends ClientError {
	override readonly code: TokenSetAuthorizationErrorCode;
	readonly reason: TokenSetAuthorizationRevocationReason;

	constructor(options: {
		reason: TokenSetAuthorizationRevocationReason;
		cause?: unknown;
	}) {
		const code =
			options.reason === TokenSetAuthorizationRevocationReason.InvalidGrant
				? TokenSetAuthorizationErrorCode.InvalidGrant
				: TokenSetAuthorizationErrorCode.InvalidToken;
		super({
			kind: ClientErrorKind.Unauthenticated,
			code,
			message: `Token-set authorization was revoked: ${options.reason}`,
			recovery: UserRecovery.Reauthenticate,
			source: TokenSetAuthorizationErrorSource,
			cause: options.cause,
		});
		this.name = "TokenSetAuthorizationRevocationError";
		this.code = code;
		this.reason = options.reason;
	}
}
