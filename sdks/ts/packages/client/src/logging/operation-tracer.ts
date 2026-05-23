import { describeError } from "../errors/index";
import type { TimeTrait } from "../scheduling/types";
import { createSpan } from "../span/span";
import type { SpanContextHostTrait, SpanTrait } from "../span/types";
import type {
	LoggerTrait,
	OperationScope,
	OperationTracerTrait,
	TraceEventSinkTrait,
} from "./types";
import { LogLevel, OperationTraceEventType } from "./types";

export interface CreateOperationTracerOptions {
	traceSink?: TraceEventSinkTrait;
	logger?: LoggerTrait;
	time?: Pick<TimeTrait, "now">;
	scope?: string;
	source?: string;
	idFactory?: () => string;
	spanContext?: SpanContextHostTrait;
}

const defaultTime: Pick<TimeTrait, "now"> = {
	now: () => Date.now(),
};

function createDefaultOperationId(): string {
	return `op_${Math.random().toString(36).slice(2, 10)}`;
}

class DefaultOperationScope implements OperationScope {
	readonly id: string;

	private readonly _attributes: Record<string, unknown>;
	private _ended = false;

	constructor(
		private readonly _span: SpanTrait,
		private readonly _name: string,
		private readonly _time: Pick<TimeTrait, "now">,
		private readonly _traceSink: TraceEventSinkTrait | undefined,
		private readonly _logger: LoggerTrait | undefined,
		private readonly _scope: string | undefined,
		private readonly _source: string | undefined,
		attributes?: Record<string, unknown>,
	) {
		this.id = this._span.id;
		this._attributes = { ...(attributes ?? {}) };
		this._recordTrace(OperationTraceEventType.Started, {
			operationName: this._name,
			...this._attributes,
		});
	}

	addEvent(type: string, attributes?: Record<string, unknown>): void {
		this._recordTrace(OperationTraceEventType.Event, {
			operationName: this._name,
			eventType: type,
			...this._attributes,
			...(attributes ?? {}),
		});
	}

	setAttribute(key: string, value: unknown): void {
		this._attributes[key] = value;
		this._span.addAttributes({ [key]: value });
	}

	recordError(error: unknown, attributes?: Record<string, unknown>): void {
		const errorAttributes = describeError(error);
		this._span.recordError(error);
		this._recordTrace(OperationTraceEventType.Error, {
			operationName: this._name,
			...this._attributes,
			...errorAttributes,
			...(attributes ?? {}),
		});
		this._logger?.log({
			level: LogLevel.Error,
			message: `Operation failed: ${this._name}`,
			scope: this._scope,
			attributes: {
				operationId: this.id,
				operationName: this._name,
				...this._attributes,
				...errorAttributes,
				...(attributes ?? {}),
			},
			error,
			at: this._time.now(),
		});
	}

	end(attributes?: Record<string, unknown>): void {
		if (this._ended) {
			return;
		}

		this._ended = true;
		this._span.end(attributes);
		this._recordTrace(OperationTraceEventType.Ended, {
			operationName: this._name,
			...this._attributes,
			...(attributes ?? {}),
		});
	}

	private _recordTrace(
		type: string,
		attributes?: Record<string, unknown>,
	): void {
		this._traceSink?.record({
			type,
			at: this._time.now(),
			scope: this._scope,
			source: this._source,
			operationId: this.id,
			spanId: this._span.id,
			parentSpanId: this._span.parentId,
			attributes,
		});
	}
}

export function createOperationTracer(
	options: CreateOperationTracerOptions = {},
): OperationTracerTrait {
	const time = options.time ?? defaultTime;
	const idFactory = options.idFactory ?? createDefaultOperationId;

	return {
		startOperation(name, attributes) {
			const parentSpan = options.spanContext?.currentSpan();
			const span =
				parentSpan?.fork({ idFactory, attributes }) ??
				createSpan({ idFactory, attributes });
			return new DefaultOperationScope(
				span,
				name,
				time,
				options.traceSink,
				options.logger,
				options.scope,
				options.source,
				attributes,
			);
		},
	};
}
