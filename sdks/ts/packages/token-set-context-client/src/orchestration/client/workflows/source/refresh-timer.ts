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
	getTokenSetAccessTokenFreshnessTiming,
	type TokenSetTokenFreshnessOptions,
	TokenSetTokenFreshnessState,
} from "../../../token/freshness";
import { type TokenSetAuthSnapshot } from "../../../token/types";
import {
	normalizeTokenSetBuiltinAuthWorkflowSourceConfig,
	TokenSetAuthWorkflowSourceConfigKind,
	type TokenSetBuiltinAuthWorkflowSourceConfig,
} from "./types";

const TokenSetRefreshTriggerKind = {
	Immediate: "immediate",
	Slice: "slice",
	Deadline: "deadline",
} as const;

export type TokenSetRefreshTriggerKind =
	(typeof TokenSetRefreshTriggerKind)[keyof typeof TokenSetRefreshTriggerKind];

export const TokenSetRefreshTimerWorkflowSourceTraceEventType = {
	Scheduled: "scheduled",
	Fired: "fired",
} as const;

export type TokenSetRefreshTimerWorkflowSourceTraceEventType =
	(typeof TokenSetRefreshTimerWorkflowSourceTraceEventType)[keyof typeof TokenSetRefreshTimerWorkflowSourceTraceEventType];

export interface TokenSetRefreshTimerWorkflowEvent {
	authSnapshot: TokenSetAuthSnapshot;
	freshnessOptions: TokenSetTokenFreshnessOptions;
}

export interface CreateTokenSetRefreshTimerWorkflowSourceOptions {
	maxScheduleSliceMs: number;
}

export interface CreateTokenSetRefreshTimerWorkflowSourceEnv {
	time: TimeTrait;
	freshnessOptions: TokenSetTokenFreshnessOptions;
	authSnapshot: ReadableReplaySignalTrait<TokenSetAuthSnapshot | null>;
	recordTrace?: (
		type: TokenSetRefreshTimerWorkflowSourceTraceEventType,
		attributes?: Record<string, unknown>,
	) => void;
}

export class TokenSetRefreshTimerWorkflowSource {
	static readonly name = "refreshTimer";

	eventStream: EventStreamTrait<TokenSetRefreshTimerWorkflowEvent>;

	protected constructor(
		readonly options: CreateTokenSetRefreshTimerWorkflowSourceOptions &
			CreateTokenSetRefreshTimerWorkflowSourceEnv,
	) {
		this.eventStream = observableToEventStream(
			signalToObservable(options.authSnapshot).pipe(
				filter(
					(snapshot): snapshot is TokenSetAuthSnapshot =>
						snapshot !== null && snapshot.tokens.refreshMaterial != null,
				),
				switchMap((snapshot) =>
					createRefreshTimerStreamForSnapshot(snapshot, options),
				),
			),
		);
	}

	static defaultBuiltInOptions: CreateTokenSetRefreshTimerWorkflowSourceOptions =
		{
			maxScheduleSliceMs: 30 * 60 * 1000, // 30 minutes
		};

	static fromBuiltin(
		env: CreateTokenSetRefreshTimerWorkflowSourceEnv,
		options: TokenSetBuiltinAuthWorkflowSourceConfig<
			Partial<CreateTokenSetRefreshTimerWorkflowSourceOptions>
		>,
	): TokenSetRefreshTimerWorkflowSource {
		const normalizedOptions = normalizeTokenSetBuiltinAuthWorkflowSourceConfig(
			options,
			TokenSetRefreshTimerWorkflowSource.defaultBuiltInOptions,
		);
		return new TokenSetRefreshTimerWorkflowSource({
			time: env.time,
			freshnessOptions: env.freshnessOptions,
			authSnapshot:
				normalizedOptions.kind === TokenSetAuthWorkflowSourceConfigKind.Bundle
					? env.authSnapshot
					: createReplaySignal(),
			maxScheduleSliceMs: normalizedOptions.options.maxScheduleSliceMs,
			recordTrace: env.recordTrace,
		});
	}
}

function createRefreshTimerStreamForSnapshot(
	authSnapshot: TokenSetAuthSnapshot,
	options: CreateTokenSetRefreshTimerWorkflowSourceOptions &
		CreateTokenSetRefreshTimerWorkflowSourceEnv,
): Observable<TokenSetRefreshTimerWorkflowEvent> {
	const now = options.time.now();
	const freshnessOptions = options.freshnessOptions;
	const freshnessTiming = getTokenSetAccessTokenFreshnessTiming(
		authSnapshot.tokens,
		now,
		freshnessOptions,
	);

	if (freshnessTiming.state === TokenSetTokenFreshnessState.NoExpiry) {
		return EMPTY;
	}

	const refreshAt = freshnessTiming.refreshAt;
	const refreshRemaining = refreshAt - now;
	if (refreshRemaining <= 0) {
		options.recordTrace?.(
			TokenSetRefreshTimerWorkflowSourceTraceEventType.Fired,
			{
				triggerKind: TokenSetRefreshTriggerKind.Immediate,
				freshnessState: freshnessTiming.state,
				refreshAt,
				delayMs: 0,
			},
		);
		return of({
			freshnessOptions: options.freshnessOptions,
			authSnapshot,
		});
	}

	const delayMs = Math.min(refreshRemaining, options.maxScheduleSliceMs);
	const triggerKind =
		refreshRemaining > options.maxScheduleSliceMs
			? TokenSetRefreshTriggerKind.Slice
			: TokenSetRefreshTriggerKind.Deadline;
	options.recordTrace?.(
		TokenSetRefreshTimerWorkflowSourceTraceEventType.Scheduled,
		{
			triggerKind,
			freshnessState: freshnessTiming.state,
			refreshAt,
			delayMs,
		},
	);
	const scheduler = createAsyncSchedulerWithTimestampProvider(options.time);

	return timer(delayMs, scheduler).pipe(
		switchMap(() => {
			const nextRefreshRemaining = refreshAt - options.time.now();
			if (nextRefreshRemaining > 0) {
				return createRefreshTimerStreamForSnapshot(authSnapshot, options);
			}
			options.recordTrace?.(
				TokenSetRefreshTimerWorkflowSourceTraceEventType.Fired,
				{
					triggerKind,
					freshnessState: freshnessTiming.state,
					refreshAt,
					delayMs,
				},
			);
			return of({
				authSnapshot,
				freshnessOptions,
			});
		}),
	);
}
