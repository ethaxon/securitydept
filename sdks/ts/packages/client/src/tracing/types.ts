import { type as defineType } from "arktype";
import { type DisposableTrait } from "../compat";
import { type EventStreamTrait, EventStreamTraitSchema } from "../events/types";
import { SecuritydeptInjectionToken } from "../injection";
import { type SpanTrait } from "../span/types";

// --- Tracing and observability ---

export const TracingLevel = {
	Debug: "debug",
	Info: "info",
	Warn: "warn",
	Error: "error",
} as const;

export type TracingLevel = (typeof TracingLevel)[keyof typeof TracingLevel];

export const OperationTraceEventType = {
	Started: "operation.started",
	Event: "operation.event",
	Error: "operation.error",
	Ended: "operation.ended",
} as const;

export type OperationTraceEventType =
	(typeof OperationTraceEventType)[keyof typeof OperationTraceEventType];

export interface TracingEvent {
	name: string;
	at: number;
	span: SpanTrait;
	level: TracingLevel;
	target: string;
	fields?: Record<string, unknown>;
}

export interface TracingTrait extends DisposableTrait {
	record(event: TracingEvent): void;
	readonly events: EventStreamTrait<TracingEvent>;
}

export const TracingTraitSchema = defineType({
	record: "Function",
	dispose: "Function",
	events: EventStreamTraitSchema,
});

export const TRACING_TRAIT_TOKEN = new SecuritydeptInjectionToken<TracingTrait>(
	"TRACING_TRAIT_TOKEN",
);
