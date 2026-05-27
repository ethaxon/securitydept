import {
	createTimeForStd,
	type EventStreamTrait,
	type PageLifecycleTrait,
	type ReadableReplaySignalTrait,
	type TimeTrait,
} from "@securitydept/client";
import { type PageResumeEvent } from "@securitydept/client/web";
import { type TokenFreshnessOptions } from "../../../token/freshness";
import { type AuthSnapshot } from "../../../token/types";
import {
	type CreatePageResumeWorkflowSourceOptions,
	PageResumeWorkflowSource,
	type PageResumeWorkflowSourceEvent,
} from "./page-resume";
import {
	type CreateRefreshTimerWorkflowSourceOptions,
	type RefreshTimerWorkflowEvent,
	RefreshTimerWorkflowSource,
} from "./refresh-timer";
import { type BuiltinAuthWorkflowSourceConfig } from "./types";

export type TokenSetAuthWorkflowTriggerData = Record<string, unknown>;

export type AuthWorkflowSource =
	EventStreamTrait<TokenSetAuthWorkflowTriggerData> & {
		readonly name?: string;
	};

export interface AuthWorkflowSourcesOptions {
	readonly [PageResumeWorkflowSource.name]?: BuiltinAuthWorkflowSourceConfig<
		Partial<CreatePageResumeWorkflowSourceOptions>
	>;
	readonly [RefreshTimerWorkflowSource.name]?: BuiltinAuthWorkflowSourceConfig<
		Partial<CreateRefreshTimerWorkflowSourceOptions>
	>;
}

export interface AuthWorkflowRuntimeOptions {
	tokenFreshness?: Partial<TokenFreshnessOptions>;
	sources?: AuthWorkflowSourcesOptions;
}

export type BuiltinAuthWorkflowSourceOption<TOptions> =
	BuiltinAuthWorkflowSourceConfig<TOptions>;

export type PageResumeWorkflowSourceOptions =
	Partial<CreatePageResumeWorkflowSourceOptions> & {
		pageLifecycle?: Pick<PageLifecycleTrait<PageResumeEvent>, "resume"> | null;
		time?: TimeTrait;
	};

export interface CreateRefreshTimerWorkflowSourceInput {
	authSnapshot: ReadableReplaySignalTrait<AuthSnapshot | null>;
	freshnessOptions: TokenFreshnessOptions;
	maxScheduleSliceMs?: number;
	time?: TimeTrait;
}

export function createPageResumeWorkflowSource(
	options: PageResumeWorkflowSourceOptions,
): EventStreamTrait<PageResumeWorkflowSourceEvent> {
	return PageResumeWorkflowSource.fromBuiltin(
		{
			pageLifecycle: options.pageLifecycle ?? undefined,
			time: options.time ?? createTimeForStd(),
		},
		{
			kind: "bundle",
			options: {
				throttleMs: options.throttleMs,
			},
		},
	).eventStream;
}

export function createRefreshTimerWorkflowSource(
	options: CreateRefreshTimerWorkflowSourceInput,
): EventStreamTrait<RefreshTimerWorkflowEvent> {
	return RefreshTimerWorkflowSource.fromBuiltin(
		{
			time: options.time ?? createTimeForStd(),
			freshnessOptions: options.freshnessOptions,
			authSnapshot: options.authSnapshot,
		},
		{
			kind: "bundle",
			options: {
				maxScheduleSliceMs: options.maxScheduleSliceMs,
			},
		},
	).eventStream;
}

export type {
	CreatePageResumeWorkflowSourceOptions,
	CreateRefreshTimerWorkflowSourceOptions,
	PageResumeWorkflowSourceEvent,
	RefreshTimerWorkflowEvent,
};

export { PageResumeWorkflowSource, RefreshTimerWorkflowSource };
