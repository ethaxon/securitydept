import { ClientError, type SpanTrait } from "@securitydept/client";

export const BasicAuthContextErrorCode = {
	OperationFailed: "basic_auth.operation_failed",
	InvalidConfig: "basic_auth.invalid_config",
	ClientDisposed: "basic_auth.client_disposed",
	RouterUnavailable: "basic_auth.router_unavailable",
	ProbePathRequired: "basic_auth.probe_path_required",
	ZoneNotFound: "basic_auth.zone_not_found",
	ZoneRequired: "basic_auth.zone_required",
} as const;

export type BasicAuthContextErrorCode =
	(typeof BasicAuthContextErrorCode)[keyof typeof BasicAuthContextErrorCode];

export const BasicAuthContextSource = {
	BasicAuthContext: "basic-auth-context",
} as const;

export type BasicAuthContextSource =
	(typeof BasicAuthContextSource)[keyof typeof BasicAuthContextSource];

export function clientErrorFromBasicAuthError(
	error: unknown,
	options: { span: SpanTrait | undefined },
): ClientError {
	return ClientError.fromUnknown(error, {
		code: BasicAuthContextErrorCode.OperationFailed,
		message: "The Basic Auth operation failed unexpectedly",
		source: BasicAuthContextSource.BasicAuthContext,
		span: options.span,
	});
}
