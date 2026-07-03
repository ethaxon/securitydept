import { isPromise } from "es-toolkit/predicate";

import { ClientError, describeError } from "../errors";
import { type TimestampProviderTrait } from "../scheduling/types";
import { SpanSharedAttributeName } from "../span/attributes";
import {
	type MutableSpanTrait,
	type SpanAttributes,
	type SpanTrait,
} from "../span/types";
import {
	type OperationSpanTrait,
	OperationTraceEventType,
	TRACING_SPAN_ATTRIBUTE_PROVIDER_ID,
	TracingLevel,
	type TracingTrait,
} from "./types";

export interface RunOperationEnvironment {
	environment: {
		time: TimestampProviderTrait;
		tracing: TracingTrait;
	};
}
export interface RunOperationOptionsBase extends RunOperationEnvironment {
	span: SpanTrait;
	name: string;
	target: string;
	traceAttributes?: SpanAttributes;
	idFactory?: () => string;
	clientErrorFromUnknown?: (
		error: unknown,
		options: { span: SpanTrait },
	) => ClientError;
}

export interface RunOperationOptions<T> extends RunOperationOptionsBase {
	execute: (span: OperationSpanTrait) => T;
}

export class OperationSpan implements OperationSpanTrait {
	private constructor(
		readonly span: MutableSpanTrait,
		private readonly _environment: RunOperationEnvironment["environment"],
		private readonly _target: string,
	) {}

	static start(options: RunOperationOptionsBase): OperationSpan {
		const span = options.span.fork({
			mutable: true,
			idFactory: options.idFactory,
			attributes: {
				[SpanSharedAttributeName.OperationName]: options.name,
			},
		});
		if (options.traceAttributes) {
			span.setAttributes(options.traceAttributes, {
				providerId: TRACING_SPAN_ATTRIBUTE_PROVIDER_ID,
			});
		}
		const operationSpan = new OperationSpan(
			span,
			options.environment,
			options.target,
		);
		operationSpan.recordStarted();
		return operationSpan;
	}

	setTraceAttributes(attributes: SpanAttributes): void {
		this.span.setAttributes(attributes, {
			providerId: TRACING_SPAN_ATTRIBUTE_PROVIDER_ID,
		});
	}

	addEvent(name: string, fields?: SpanAttributes): void {
		this._record(OperationTraceEventType.Event, TracingLevel.Info, {
			eventName: name,
			...(fields ?? {}),
		});
	}

	recordError(error: unknown, fields?: SpanAttributes): void {
		this._record(OperationTraceEventType.Error, TracingLevel.Error, {
			...describeError(error),
			...(fields ?? {}),
		});
	}

	recordStarted(): void {
		this._record(OperationTraceEventType.Started, TracingLevel.Info);
	}

	recordEnded(outcome: "succeeded" | "failed"): void {
		this._record(
			OperationTraceEventType.Ended,
			outcome === "succeeded" ? TracingLevel.Info : TracingLevel.Error,
			{ outcome },
		);
	}

	private _record(
		name: string,
		level: TracingLevel,
		fields?: SpanAttributes,
	): void {
		this._environment.tracing.record({
			name,
			at: this._environment.time.now(),
			span: this.span,
			level,
			target: this._target,
			fields,
		});
	}
}

export function runOperation<T>(options: RunOperationOptions<T>): T;
export function runOperation<T>(
	options: RunOperationOptions<Promise<T>>,
): Promise<T>;
export function runOperation<T>(
	options: RunOperationOptions<T | Promise<T>>,
): T | Promise<T> {
	const operationSpan = OperationSpan.start(options);
	try {
		const result = options.execute(operationSpan);
		if (isPromise(result)) {
			return result.then(
				(value) => completeOperation(operationSpan, value),
				(error) =>
					failOperation(operationSpan, error, options.clientErrorFromUnknown),
			);
		}
		return completeOperation(operationSpan, result);
	} catch (error) {
		return failOperation(operationSpan, error, options.clientErrorFromUnknown);
	}
}

function completeOperation<T>(operationSpan: OperationSpan, result: T): T {
	operationSpan.recordEnded("succeeded");
	return result;
}

function failOperation(
	operationSpan: OperationSpan,
	error: unknown,
	clientErrorFromUnknown: RunOperationOptionsBase["clientErrorFromUnknown"],
): never {
	const clientError = clientErrorFromUnknown
		? clientErrorFromUnknown(error, { span: operationSpan.span })
		: error;
	if (clientError instanceof ClientError) {
		clientError.captureSpanContext(operationSpan.span);
	}
	operationSpan.recordError(clientError);
	operationSpan.recordEnded("failed");
	throw clientError;
}
