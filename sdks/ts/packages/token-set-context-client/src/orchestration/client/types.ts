import {
	type FoundationEnvironment,
	type ReadableSignalTrait,
	type StorageTrait,
} from "@securitydept/client";
import { type TokenFreshnessOptions } from "../token/freshness";
import { type CreatePageResumeWorkflowSourceOptions } from "./workflows/source/page-resume";
import { type CreateRefreshTimerWorkflowSourceOptions } from "./workflows/source/refresh-timer";
import { type BuiltinAuthWorkflowSourceConfig } from "./workflows/source/types";

export interface BaseOidcModeClientOptions {
	environment: FoundationEnvironment;
	refresh?: Partial<{
		tokenFreshness?: Partial<TokenFreshnessOptions>;
		sources: {
			refreshTimer?: BuiltinAuthWorkflowSourceConfig<
				Partial<CreateRefreshTimerWorkflowSourceOptions>
			>;
			pageResume?: BuiltinAuthWorkflowSourceConfig<
				Partial<CreatePageResumeWorkflowSourceOptions>
			>;
		};
	}>;
	traceTarget: string;
	tracePrefix: string;
	clientName: string;
	id?: string;
	persistence?: {
		store: StorageTrait;
		key: string;
	};
	autoStart?: boolean;
}

export const StateRestoreSourceKind = {
	Manual: "manual",
	PersistentStore: "persistent_store",
} as const;

export type StateRestoreSourceKind =
	(typeof StateRestoreSourceKind)[keyof typeof StateRestoreSourceKind];

export interface TokenSetAuthOperationSignals {
	readonly restorePending: ReadableSignalTrait<boolean>;
	readonly refreshPending: ReadableSignalTrait<boolean>;
	readonly clearPending: ReadableSignalTrait<boolean>;
	readonly loginPending: ReadableSignalTrait<boolean>;
}
