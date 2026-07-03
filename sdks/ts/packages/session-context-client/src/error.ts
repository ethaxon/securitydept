import { ClientError, type SpanTrait } from "@securitydept/client";

export const SessionContextErrorCode = {
	OperationFailed: "session.operation_failed",
	ClientDisposed: "session.client_disposed",
	RouterUnavailable: "session.router_unavailable",
	InvalidSessionPayload: "session.invalid_user_info_payload",
} as const;

export type SessionContextErrorCode =
	(typeof SessionContextErrorCode)[keyof typeof SessionContextErrorCode];

export const SessionContextSource = {
	SessionContext: "session-context",
} as const;

export type SessionContextSource =
	(typeof SessionContextSource)[keyof typeof SessionContextSource];

export function clientErrorFromSessionError(
	error: unknown,
	options: { span: SpanTrait | undefined },
): ClientError {
	return ClientError.fromUnknown(error, {
		code: SessionContextErrorCode.OperationFailed,
		message: "The session operation failed unexpectedly",
		source: SessionContextSource.SessionContext,
		span: options.span,
	});
}
