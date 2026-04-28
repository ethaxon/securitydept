// --- Event system trait types ---

/** Subscription handle with explicit unsubscribe. */
export interface EventSubscriptionTrait {
	unsubscribe(): void;
}

/** Observer for event streams — mirrors the Observable observer pattern. */
export interface EventObserver<T> {
	next?(value: T): void;
	error?(error: unknown): void;
	complete?(): void;
}

/** Read-only event stream — lazy push-based sequence. */
export interface EventStreamTrait<T> {
	subscribe(observer: EventObserver<T>): EventSubscriptionTrait;
}

/** Hot event producer. */
export interface SubjectTrait<T> extends EventStreamTrait<T> {
	next(value: T): void;
	error(error: unknown): void;
	complete(): void;
}

/** Hot event producer that replays recent values to late subscribers. */
export interface ReplaySubjectTrait<T> extends SubjectTrait<T> {
	readonly bufferSize: number;
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
