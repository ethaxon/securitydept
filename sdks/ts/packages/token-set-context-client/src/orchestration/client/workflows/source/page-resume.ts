import {
	createNeverEventStream,
	type EventStreamTrait,
	eventStreamToObservable,
	observableToEventStream,
	type PageLifecycleTrait,
	type TimestampProviderTrait,
} from "@securitydept/client";
import { createAsyncSchedulerWithTimestampProvider } from "@securitydept/client/rx";
import type {
	FoundationEnvironment,
	PageResumeEvent,
} from "@securitydept/client/web";
import { throttleTime } from "rxjs";
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
	time: TimestampProviderTrait;
}

export type PageResumeWorkflowSourceEvent = PageResumeEvent;

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
		});
	}
}
