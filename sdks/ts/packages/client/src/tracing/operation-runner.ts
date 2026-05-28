import { isPromise } from "es-toolkit/predicate";

import { describeError } from "../errors";
import { type TimestampProviderTrait } from "../scheduling/types";
import {
	type MutableSpanCreateOptions,
	type MutableSpanTrait,
	type OperationSpanTrait,
	type SpanCreateOptions,
	type SpanTrait,
} from "../span/types";
import {
	OperationTraceEventType,
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
	fields?: Record<string, unknown>;
	idFactory?: () => string;
}

export interface RunOperationOptions<T> extends RunOperationOptionsBase {
	execute: (span: OperationSpanTrait) => T;
}

class OperationSpan implements OperationSpanTrait {
	constructor(
		private readonly _span: MutableSpanTrait,
		private readonly _environment: RunOperationEnvironment["environment"],
		private readonly _name: string,
		private readonly _target: string,
	) {}

	get id(): string {
		return this._span.id;
	}

	get parent(): SpanTrait | undefined {
		return this._span.parent;
	}

	get attributes(): Readonly<Record<string, unknown>> {
		return this._span.attributes;
	}

	fork(options: MutableSpanCreateOptions): MutableSpanTrait;
	fork(options?: SpanCreateOptions): SpanTrait;
	fork(
		options: SpanCreateOptions | MutableSpanCreateOptions = {},
	): SpanTrait | MutableSpanTrait {
		return this._span.fork(options);
	}

	setAttributes(attributes: Record<string, unknown>): void {
		this._span.setAttributes(attributes);
	}

	addEvent(name: string, fields?: Record<string, unknown>): void {
		this._record(OperationTraceEventType.Event, TracingLevel.Info, {
			eventName: name,
			...(fields ?? {}),
		});
	}

	recordError(error: unknown, fields?: Record<string, unknown>): void {
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
		fields?: Record<string, unknown>,
	): void {
		this._environment.tracing.record({
			name,
			at: this._environment.time.now(),
			span: this,
			level,
			target: this._target,
			fields: {
				operationName: this._name,
				...this.attributes,
				...(fields ?? {}),
			},
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
	const span = options.span.fork({
		mutable: true,
		idFactory: options.idFactory,
		attributes: options.fields,
	});
	const operationSpan = new OperationSpan(
		span,
		options.environment,
		options.name,
		options.target,
	);
	operationSpan.recordStarted();
	const complete = (result: T): T => {
		operationSpan.recordEnded("succeeded");
		return result;
	};
	const fail = (error: unknown): never => {
		operationSpan.recordError(error);
		operationSpan.recordEnded("failed");
		throw error;
	};

	const invoke = () => options.execute(operationSpan);
	try {
		const result = invoke();
		if (isPromise(result)) {
			return result.then(complete, fail);
		}
		return complete(result);
	} catch (error) {
		return fail(error);
	}
}
