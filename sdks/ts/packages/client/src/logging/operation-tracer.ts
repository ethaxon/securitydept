import type { Clock } from "../scheduling/types";
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
	clock?: Clock;
	scope?: string;
	source?: string;
	idFactory?: () => string;
}

const defaultClock: Clock = {
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
		private readonly _name: string,
		private readonly _clock: Clock,
		private readonly _traceSink: TraceEventSinkTrait | undefined,
		private readonly _logger: LoggerTrait | undefined,
		private readonly _scope: string | undefined,
		private readonly _source: string | undefined,
		idFactory: () => string,
		attributes?: Record<string, unknown>,
	) {
		this.id = idFactory();
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
	}

	recordError(error: unknown, attributes?: Record<string, unknown>): void {
		const errorAttributes = describeError(error);
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
			at: this._clock.now(),
		});
	}

	end(attributes?: Record<string, unknown>): void {
		if (this._ended) {
			return;
		}

		this._ended = true;
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
			at: this._clock.now(),
			scope: this._scope,
			source: this._source,
			operationId: this.id,
			attributes,
		});
	}
}

export function createOperationTracer(
	options: CreateOperationTracerOptions = {},
): OperationTracerTrait {
	const clock = options.clock ?? defaultClock;
	const idFactory = options.idFactory ?? createDefaultOperationId;

	return {
		startOperation(name, attributes) {
			return new DefaultOperationScope(
				name,
				clock,
				options.traceSink,
				options.logger,
				options.scope,
				options.source,
				idFactory,
				attributes,
			);
		},
	};
}

function describeError(error: unknown): Record<string, unknown> {
	if (
		typeof error === "object" &&
		error !== null &&
		"name" in error &&
		"message" in error
	) {
		const genericError = error as Pick<Error, "name" | "message">;
		return {
			errorName: genericError.name,
			errorMessage: genericError.message,
		};
	}

	return { errorValue: String(error) };
}
