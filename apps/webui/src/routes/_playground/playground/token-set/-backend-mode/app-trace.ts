import {
	ClientError,
	type SpanTrait,
	TracingLevel,
	type TracingTrait,
} from "@securitydept/client";
import { TOKEN_SET_BACKEND_MODE_CONFIG } from "@/auth/token-set/config";

export function createTokenSetBackendHostTraceRecorder(
	tracing: TracingTrait,
	span: SpanTrait,
): (name: string, fields?: Record<string, unknown>) => void {
	return (name: string, fields?: Record<string, unknown>) => {
		tracing.record({
			name,
			at: Date.now(),
			target: TOKEN_SET_BACKEND_MODE_CONFIG.tracing.hostTarget,
			span,
			level: TracingLevel.Info,
			fields,
		});
	};
}

export const createTokenSetAppTraceRecorder =
	createTokenSetBackendHostTraceRecorder;

export function readTokenSetTraceErrorFields(
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
