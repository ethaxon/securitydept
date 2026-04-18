import { ClientError, type TraceEventSinkTrait } from "@securitydept/client";

export const TOKEN_SET_BACKEND_HOST_TRACE_SCOPE =
	"apps.webui.token-set-backend";
export const TOKEN_SET_BACKEND_HOST_TRACE_SOURCE = "webui.token-set-backend";

export function createTokenSetBackendHostTraceRecorder(
	traceSink: TraceEventSinkTrait,
): (type: string, attributes?: Record<string, unknown>) => void {
	return (type: string, attributes?: Record<string, unknown>) => {
		traceSink.record({
			type,
			at: Date.now(),
			scope: TOKEN_SET_BACKEND_HOST_TRACE_SCOPE,
			source: TOKEN_SET_BACKEND_HOST_TRACE_SOURCE,
			attributes,
		});
	};
}

export const createTokenSetAppTraceRecorder =
	createTokenSetBackendHostTraceRecorder;

export function readTokenSetTraceErrorAttributes(
	error: unknown,
	fallback: string,
): Record<string, unknown> {
	if (error instanceof ClientError) {
		return {
			kind: error.kind,
			code: error.code,
			message: error.message,
			recovery: error.recovery,
			retryable: error.retryable,
		};
	}

	if (error instanceof Error) {
		return {
			message: error.message,
		};
	}

	return {
		message: fallback,
	};
}
