import {
	createNeverEventStream,
	type EventStreamTrait,
	type PageLifecycleTrait,
	type TimeTrait,
} from "@securitydept/client";
import {
	createAsyncSchedulerWithTimestampProvider,
	eventStreamToObservable,
	observableToEventStream,
} from "@securitydept/client/rx";
import { type PageResumeEvent } from "@securitydept/client/web";
import { tap, throttleTime } from "rxjs";
import {
	normalizeTokenSetBuiltinAuthWorkflowSourceConfig,
	type TokenSetBuiltinAuthWorkflowSourceConfig,
} from "./types";

export interface CreateTokenSetPageResumeWorkflowSourceOptions {
	throttleMs: number;
}

export interface CreateTokenSetPageResumeWorkflowSourceEnv {
	pageLifecycle:
		| Pick<PageLifecycleTrait<PageResumeEvent>, "resume">
		| undefined;
	time: TimeTrait;
	recordTrace?: (
		type: TokenSetPageResumeWorkflowSourceTraceEventType,
		attributes?: Record<string, unknown>,
	) => void;
}

export type TokenSetPageResumeWorkflowSourceEvent = PageResumeEvent;

export const TokenSetPageResumeWorkflowSourceTraceEventType = {
	Fired: "fired",
} as const;

export type TokenSetPageResumeWorkflowSourceTraceEventType =
	(typeof TokenSetPageResumeWorkflowSourceTraceEventType)[keyof typeof TokenSetPageResumeWorkflowSourceTraceEventType];

export class TokenSetPageResumeWorkflowSource {
	static readonly name = "pageResume";

	static readonly defaultBuiltInOptions: CreateTokenSetPageResumeWorkflowSourceOptions =
		{
			throttleMs: 500,
		};

	eventStream: EventStreamTrait<TokenSetPageResumeWorkflowSourceEvent>;

	protected constructor(
		readonly options: CreateTokenSetPageResumeWorkflowSourceOptions &
			CreateTokenSetPageResumeWorkflowSourceEnv,
	) {
		const throttleMs = options.throttleMs;
		this.eventStream = observableToEventStream(
			eventStreamToObservable(
				options.pageLifecycle?.resume ??
					createNeverEventStream<PageResumeEvent>(),
			).pipe(
				throttleTime(
					throttleMs,
					createAsyncSchedulerWithTimestampProvider(options.time),
				),
				tap((event) => {
					options.recordTrace?.(
						TokenSetPageResumeWorkflowSourceTraceEventType.Fired,
						{
							trigger: event.trigger,
							persisted: event.persisted,
						},
					);
				}),
			),
		);
	}

	static fromBuiltin(
		env: CreateTokenSetPageResumeWorkflowSourceEnv,
		config: TokenSetBuiltinAuthWorkflowSourceConfig<
			Partial<CreateTokenSetPageResumeWorkflowSourceOptions>
		>,
	): TokenSetPageResumeWorkflowSource {
		const normalizedConfig = normalizeTokenSetBuiltinAuthWorkflowSourceConfig(
			config,
			TokenSetPageResumeWorkflowSource.defaultBuiltInOptions,
		);
		return new TokenSetPageResumeWorkflowSource({
			pageLifecycle:
				normalizedConfig.kind === "bundle" ? env.pageLifecycle : undefined,
			time: env.time,
			throttleMs: normalizedConfig.options.throttleMs,
			recordTrace: env.recordTrace,
		});
	}
}
