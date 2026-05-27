import { type as defineType } from "arktype";
// --- Event system trait types ---
import { isInteropObservableTrait, type SubscriptionTrait } from "../compat";

/** Subscription handle with explicit unsubscribe. */
export type EventSubscriptionTrait = SubscriptionTrait;

/** Observer for event streams — mirrors the Observable observer pattern. */
export interface EventObserverTrait<T> {
	next(value: T): void;
	error(error: unknown): void;
	complete(): void;
}

/** Read-only event stream — lazy push-based sequence. */
export interface EventStreamTrait<T> {
	subscribe(observer: Partial<EventObserverTrait<T>>): EventSubscriptionTrait;
	[Symbol.observable](): {
		subscribe(observer: Partial<EventObserverTrait<T>>): EventSubscriptionTrait;
	};
}

export const EventStreamTraitSchema = defineType({
	subscribe: "Function",
});

/** Hot event producer. */
export interface EventSubjectTrait<T> extends EventStreamTrait<T> {
	next(value: T): void;
	error(error: unknown): void;
	complete(): void;
}

// --- Event envelope ---

export const EventSourceKind = {
	User: "user",
	Timer: "timer",
	Http: "http",
	Storage: "storage",
	Framework: "framework",
	System: "system",
} as const;

export type EventSourceKind =
	(typeof EventSourceKind)[keyof typeof EventSourceKind];

export type EventSource =
	| { kind: typeof EventSourceKind.User; actor?: string }
	| { kind: typeof EventSourceKind.Timer; timer: string }
	| { kind: typeof EventSourceKind.Http; requestId: string; endpoint?: string }
	| { kind: typeof EventSourceKind.Storage; operation: string }
	| { kind: typeof EventSourceKind.Framework; name: string }
	| { kind: typeof EventSourceKind.System; subsystem: string };

export interface RuntimeEventEnvelope<TType extends string, TPayload> {
	id: string;
	type: TType;
	at: number;
	source: EventSource;
	payload: TPayload;
}

export type EventOperatorFunction<T, R> = (
	stream: EventStreamTrait<T>,
) => EventStreamTrait<R>;

export function isEventStreamTrait(
	value: unknown,
): value is EventStreamTrait<unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as EventStreamTrait<unknown>).subscribe === "function" &&
		isInteropObservableTrait(value)
	);
}
