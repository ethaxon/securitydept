import { describeError } from "../errors";
import { type TimestampProviderTrait } from "../scheduling/types";
import { type OperationSpanTrait, type SpanTrait } from "../span/types";
import { isPromiseLike } from "./promise-like";
import {
	OperationTraceEventType,
	TracingLevel,
	type TracingTrait,
} from "./types";

function createDefaultOperationId(): string {
	return `op_${Math.random().toString(36).slice(2, 10)}`;
}

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
	fields?: Record<string, unknown>;
	idFactory?: () => string;
}

export interface RunOperationOptions<T> extends RunOperationOptionsBase {
	execute: (span: OperationSpanTrait) => T;
}

export function runOperation<T>(options: RunOperationOptions<T>): T;
export function runOperation<T>(
	options: RunOperationOptions<Promise<T>>,
): Promise<T>;
export function runOperation<T>(
	options: RunOperationOptions<T | Promise<T>>,
): T | Promise<T> {
	const time = options.environment.time;
	const operationSpanIdFactory = options.idFactory ?? createDefaultOperationId;
	const span = options.span.fork({
		idFactory: operationSpanIdFactory,
		attributes: options.fields,
	});
	const mutableFields: Record<string, unknown> = { ...(options.fields ?? {}) };
	const record = (
		name: string,
		level: TracingLevel,
		fields?: Record<string, unknown>,
	) => {
		options.environment.tracing.record({
			name,
			at: time.now(),
			span: operationSpan,
			level,
			target: options.target,
			fields,
		});
	};
	const operationSpan: OperationSpanTrait = {
		get id() {
			return span.id;
		},
		get parent() {
			return span.parent;
		},
		get attributes() {
			return Object.freeze({
				...span.attributes,
				...mutableFields,
			});
		},
		addEvent(name, fields) {
			record(OperationTraceEventType.Event, TracingLevel.Info, {
				operationName: options.name,
				eventName: name,
				...mutableFields,
				...(fields ?? {}),
			});
		},
		setAttribute(key, value) {
			mutableFields[key] = value;
		},
		recordError(error, fields) {
			record(OperationTraceEventType.Error, TracingLevel.Error, {
				operationName: options.name,
				...mutableFields,
				...describeError(error),
				...(fields ?? {}),
			});
		},
		fork(forkOptions = {}) {
			return span.fork(forkOptions);
		},
	};
	record(OperationTraceEventType.Started, TracingLevel.Info, {
		operationName: options.name,
		...mutableFields,
	});
	const complete = (result: T): T => {
		record(OperationTraceEventType.Ended, TracingLevel.Info, {
			operationName: options.name,
			...mutableFields,
			outcome: "succeeded",
		});
		return result;
	};
	const fail = (error: unknown): never => {
		operationSpan.recordError(error);
		record(OperationTraceEventType.Ended, TracingLevel.Error, {
			operationName: options.name,
			...mutableFields,
			outcome: "failed",
		});
		throw error;
	};

	const invoke = () => options.execute(operationSpan);
	try {
		const result = invoke();
		if (isPromiseLike(result)) {
			return Promise.resolve(result).then(complete, fail);
		}
		return complete(result);
	} catch (error) {
		return fail(error);
	}
}
