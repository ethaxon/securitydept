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
	type BuiltinAuthWorkflowSourceConfig,
	normalizeBuiltinAuthWorkflowSourceConfig,
} from "./types";

export interface CreatePageResumeWorkflowSourceOptions {
	throttleMs: number;
}

export interface CreatePageResumeWorkflowSourceEnv {
	pageLifecycle:
		| Pick<PageLifecycleTrait<PageResumeEvent>, "resume">
		| undefined;
	time: TimeTrait;
	recordTrace?: (
		type: PageResumeWorkflowSourceTraceEventType,
		attributes?: Record<string, unknown>,
	) => void;
}

export type PageResumeWorkflowSourceEvent = PageResumeEvent;

export const PageResumeWorkflowSourceTraceEventType = {
	Fired: "fired",
} as const;

export type PageResumeWorkflowSourceTraceEventType =
	(typeof PageResumeWorkflowSourceTraceEventType)[keyof typeof PageResumeWorkflowSourceTraceEventType];

export class PageResumeWorkflowSource {
	static readonly name = "pageResume";

	static readonly defaultBuiltInOptions: CreatePageResumeWorkflowSourceOptions =
		{
			throttleMs: 500,
		};

	eventStream: EventStreamTrait<PageResumeWorkflowSourceEvent>;

	protected constructor(
		readonly options: CreatePageResumeWorkflowSourceOptions &
			CreatePageResumeWorkflowSourceEnv,
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
					options.recordTrace?.(PageResumeWorkflowSourceTraceEventType.Fired, {
						trigger: event.trigger,
						persisted: event.persisted,
					});
				}),
			),
		);
	}

	static fromBuiltin(
		env: CreatePageResumeWorkflowSourceEnv,
		config: BuiltinAuthWorkflowSourceConfig<
			Partial<CreatePageResumeWorkflowSourceOptions>
		>,
	): PageResumeWorkflowSource {
		const normalizedConfig = normalizeBuiltinAuthWorkflowSourceConfig(
			config,
			PageResumeWorkflowSource.defaultBuiltInOptions,
		);
		return new PageResumeWorkflowSource({
			pageLifecycle:
				normalizedConfig.kind === "bundle" ? env.pageLifecycle : undefined,
			time: env.time,
			throttleMs: normalizedConfig.options.throttleMs,
			recordTrace: env.recordTrace,
		});
	}
}
