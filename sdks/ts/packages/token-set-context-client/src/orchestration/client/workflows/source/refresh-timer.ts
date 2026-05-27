import {
	createReplaySignal,
	type EventStreamTrait,
	type ReadableReplaySignalTrait,
	type TimeTrait,
} from "@securitydept/client";
import {
	createAsyncSchedulerWithTimestampProvider,
	observableToEventStream,
	signalToObservable,
} from "@securitydept/client/rx";
import { EMPTY, filter, type Observable, of, switchMap, timer } from "rxjs";
import {
	getAccessTokenFreshnessTiming,
	type TokenFreshnessOptions,
	TokenFreshnessState,
} from "../../../token/freshness";
import { type AuthSnapshot } from "../../../token/types";
import {
	AuthWorkflowSourceConfigKind,
	type BuiltinAuthWorkflowSourceConfig,
	normalizeBuiltinAuthWorkflowSourceConfig,
} from "./types";

const RefreshTriggerKind = {
	Immediate: "immediate",
	Slice: "slice",
	Deadline: "deadline",
} as const;

export type RefreshTriggerKind =
	(typeof RefreshTriggerKind)[keyof typeof RefreshTriggerKind];

export const RefreshTimerWorkflowSourceTraceEventType = {
	Scheduled: "scheduled",
	Fired: "fired",
} as const;

export type RefreshTimerWorkflowSourceTraceEventType =
	(typeof RefreshTimerWorkflowSourceTraceEventType)[keyof typeof RefreshTimerWorkflowSourceTraceEventType];

export interface RefreshTimerWorkflowEvent {
	authSnapshot: AuthSnapshot;
	freshnessOptions: TokenFreshnessOptions;
}

export interface CreateRefreshTimerWorkflowSourceOptions {
	maxScheduleSliceMs: number;
}

export interface CreateRefreshTimerWorkflowSourceEnv {
	time: TimeTrait;
	freshnessOptions: TokenFreshnessOptions;
	authSnapshot: ReadableReplaySignalTrait<AuthSnapshot | null>;
	recordTrace?: (
		type: RefreshTimerWorkflowSourceTraceEventType,
		attributes?: Record<string, unknown>,
	) => void;
}

export class RefreshTimerWorkflowSource {
	static readonly name = "refreshTimer";

	eventStream: EventStreamTrait<RefreshTimerWorkflowEvent>;

	protected constructor(
		readonly options: CreateRefreshTimerWorkflowSourceOptions &
			CreateRefreshTimerWorkflowSourceEnv,
	) {
		this.eventStream = observableToEventStream(
			signalToObservable(options.authSnapshot).pipe(
				filter(
					(snapshot): snapshot is AuthSnapshot =>
						snapshot !== null && snapshot.tokens.refreshMaterial != null,
				),
				switchMap((snapshot) =>
					createRefreshTimerStreamForSnapshot(snapshot, options),
				),
			),
		);
	}

	static defaultBuiltInOptions: CreateRefreshTimerWorkflowSourceOptions = {
		maxScheduleSliceMs: 30 * 60 * 1000, // 30 minutes
	};

	static fromBuiltin(
		env: CreateRefreshTimerWorkflowSourceEnv,
		options: BuiltinAuthWorkflowSourceConfig<
			Partial<CreateRefreshTimerWorkflowSourceOptions>
		>,
	): RefreshTimerWorkflowSource {
		const normalizedOptions = normalizeBuiltinAuthWorkflowSourceConfig(
			options,
			RefreshTimerWorkflowSource.defaultBuiltInOptions,
		);
		return new RefreshTimerWorkflowSource({
			time: env.time,
			freshnessOptions: env.freshnessOptions,
			authSnapshot:
				normalizedOptions.kind === AuthWorkflowSourceConfigKind.Bundle
					? env.authSnapshot
					: createReplaySignal(),
			maxScheduleSliceMs: normalizedOptions.options.maxScheduleSliceMs,
			recordTrace: env.recordTrace,
		});
	}
}

function createRefreshTimerStreamForSnapshot(
	authSnapshot: AuthSnapshot,
	options: CreateRefreshTimerWorkflowSourceOptions &
		CreateRefreshTimerWorkflowSourceEnv,
): Observable<RefreshTimerWorkflowEvent> {
	const now = options.time.now();
	const freshnessOptions = options.freshnessOptions;
	const freshnessTiming = getAccessTokenFreshnessTiming(
		authSnapshot.tokens,
		now,
		freshnessOptions,
	);

	if (freshnessTiming.state === TokenFreshnessState.NoExpiry) {
		return EMPTY;
	}

	const refreshAt = freshnessTiming.refreshAt;
	const refreshRemaining = refreshAt - now;
	if (refreshRemaining <= 0) {
		options.recordTrace?.(RefreshTimerWorkflowSourceTraceEventType.Fired, {
			triggerKind: RefreshTriggerKind.Immediate,
			freshnessState: freshnessTiming.state,
			refreshAt,
			delayMs: 0,
		});
		return of({
			freshnessOptions: options.freshnessOptions,
			authSnapshot,
		});
	}

	const delayMs = Math.min(refreshRemaining, options.maxScheduleSliceMs);
	const triggerKind =
		refreshRemaining > options.maxScheduleSliceMs
			? RefreshTriggerKind.Slice
			: RefreshTriggerKind.Deadline;
	options.recordTrace?.(RefreshTimerWorkflowSourceTraceEventType.Scheduled, {
		triggerKind,
		freshnessState: freshnessTiming.state,
		refreshAt,
		delayMs,
	});
	const scheduler = createAsyncSchedulerWithTimestampProvider(options.time);

	return timer(delayMs, scheduler).pipe(
		switchMap(() => {
			const nextRefreshRemaining = refreshAt - options.time.now();
			if (nextRefreshRemaining > 0) {
				return createRefreshTimerStreamForSnapshot(authSnapshot, options);
			}
			options.recordTrace?.(RefreshTimerWorkflowSourceTraceEventType.Fired, {
				triggerKind,
				freshnessState: freshnessTiming.state,
				refreshAt,
				delayMs,
			});
			return of({
				authSnapshot,
				freshnessOptions,
			});
		}),
	);
}
