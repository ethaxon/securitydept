import {
	createTimeForStd,
	type EventStreamTrait,
	type PageLifecycleTrait,
	type ReadableReplaySignalTrait,
	type TimeTrait,
} from "@securitydept/client";
import { type PageResumeEvent } from "@securitydept/client/web";
import { type TokenSetTokenFreshnessOptions } from "../../../token/freshness";
import { type TokenSetAuthSnapshot } from "../../../token/types";
import {
	type CreateTokenSetPageResumeWorkflowSourceOptions,
	TokenSetPageResumeWorkflowSource,
	type TokenSetPageResumeWorkflowSourceEvent,
} from "./page-resume";
import {
	type CreateTokenSetRefreshTimerWorkflowSourceOptions,
	type TokenSetRefreshTimerWorkflowEvent,
	TokenSetRefreshTimerWorkflowSource,
} from "./refresh-timer";
import { type TokenSetBuiltinAuthWorkflowSourceConfig } from "./types";

export type TokenSetAuthWorkflowTriggerData = Record<string, unknown>;

export type TokenSetAuthWorkflowSource =
	EventStreamTrait<TokenSetAuthWorkflowTriggerData> & {
		readonly name?: string;
	};

export interface TokenSetAuthWorkflowSourcesOptions {
	readonly [TokenSetPageResumeWorkflowSource.name]?: TokenSetBuiltinAuthWorkflowSourceConfig<
		Partial<CreateTokenSetPageResumeWorkflowSourceOptions>
	>;
	readonly [TokenSetRefreshTimerWorkflowSource.name]?: TokenSetBuiltinAuthWorkflowSourceConfig<
		Partial<CreateTokenSetRefreshTimerWorkflowSourceOptions>
	>;
}

export interface TokenSetAuthWorkflowRuntimeOptions {
	tokenFreshness?: Partial<TokenSetTokenFreshnessOptions>;
	sources?: TokenSetAuthWorkflowSourcesOptions;
}

export type TokenSetBuiltinAuthWorkflowSourceOption<TOptions> =
	TokenSetBuiltinAuthWorkflowSourceConfig<TOptions>;

export type TokenSetPageResumeWorkflowSourceOptions =
	Partial<CreateTokenSetPageResumeWorkflowSourceOptions> & {
		pageLifecycle?: Pick<PageLifecycleTrait<PageResumeEvent>, "resume"> | null;
		time?: TimeTrait;
	};

export interface CreateTokenSetRefreshTimerWorkflowSourceInput {
	authSnapshot: ReadableReplaySignalTrait<TokenSetAuthSnapshot | null>;
	freshnessOptions: TokenSetTokenFreshnessOptions;
	maxScheduleSliceMs?: number;
	time?: TimeTrait;
}

export function createTokenSetPageResumeWorkflowSource(
	options: TokenSetPageResumeWorkflowSourceOptions,
): EventStreamTrait<TokenSetPageResumeWorkflowSourceEvent> {
	return TokenSetPageResumeWorkflowSource.fromBuiltin(
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

export function createTokenSetRefreshTimerWorkflowSource(
	options: CreateTokenSetRefreshTimerWorkflowSourceInput,
): EventStreamTrait<TokenSetRefreshTimerWorkflowEvent> {
	return TokenSetRefreshTimerWorkflowSource.fromBuiltin(
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

export {
	type CreateTokenSetPageResumeWorkflowSourceOptions,
	type CreateTokenSetRefreshTimerWorkflowSourceOptions,
	TokenSetPageResumeWorkflowSource,
	type TokenSetPageResumeWorkflowSourceEvent,
	type TokenSetRefreshTimerWorkflowEvent,
	TokenSetRefreshTimerWorkflowSource,
};
