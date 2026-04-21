// --- Logging and observability ---

export const LogLevel = {
	Debug: "debug",
	Info: "info",
	Warn: "warn",
	Error: "error",
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export interface LogEntry {
	level: LogLevel;
	message: string;
	scope?: string;
	code?: string;
	attributes?: Record<string, unknown>;
	error?: unknown;
	at?: number;
}

export interface LoggerTrait {
	log(entry: LogEntry): void;
}

export const OperationTraceEventType = {
	Started: "operation.started",
	Event: "operation.event",
	Error: "operation.error",
	Ended: "operation.ended",
} as const;

export type OperationTraceEventType =
	(typeof OperationTraceEventType)[keyof typeof OperationTraceEventType];

export interface TraceEvent {
	type: string;
	at: number;
	scope?: string;
	operationId?: string;
	source?: string;
	attributes?: Record<string, unknown>;
}

export interface TraceEventSinkTrait {
	record(event: TraceEvent): void;
}

export interface OperationScope {
	id: string;
	addEvent(type: string, attributes?: Record<string, unknown>): void;
	setAttribute(key: string, value: unknown): void;
	recordError(error: unknown, attributes?: Record<string, unknown>): void;
	end(attributes?: Record<string, unknown>): void;
}

export interface OperationTracerTrait {
	startOperation(
		name: string,
		attributes?: Record<string, unknown>,
	): OperationScope;
}
