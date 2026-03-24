import { ClientError, type TraceEventSinkTrait } from "@securitydept/client";

const APP_TRACE_SCOPE = "apps.webui.token-set";
const APP_TRACE_SOURCE = "webui.token-set";

export function createTokenSetAppTraceRecorder(
	traceSink: TraceEventSinkTrait,
): (type: string, attributes?: Record<string, unknown>) => void {
	return (type: string, attributes?: Record<string, unknown>) => {
		traceSink.record({
			type,
			at: Date.now(),
			scope: APP_TRACE_SCOPE,
			source: APP_TRACE_SOURCE,
			attributes,
		});
	};
}

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
