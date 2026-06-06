import {
	type CompatFragmentParameters,
	createOnceAsyncLockCallable,
	type OnceAsyncLock,
	type OnceAsyncLockCallable,
	type ReadableSignalTrait,
} from "@securitydept/client";
import { BackendOidcModeClient } from "../../backend-oidc-mode";
import { type TokenSetAuthSnapshot } from "../../orchestration";
import { type BaseOidcModeClient } from "../../orchestration/client/base-client";
import { type TokenSetClientQueryOptions } from "../contracts/query";
import {
	type TokenSetClientReadyRecordView,
	type TokenSetClientRecordView,
} from "../contracts/types";
import { type TokenSetClientRegistry } from "../core/client-registry";
import {
	TokenSetClientRegistryError,
	TokenSetClientRegistryErrorCode,
} from "../core/error";

export interface BackendOidcModeCallbackInput {
	payload: () => CompatFragmentParameters;
	clientQuery: () => TokenSetClientQueryOptions;
}

export interface BackendOidcModeCallbackOptions
	extends BackendOidcModeCallbackInput {
	registry: () => TokenSetClientRegistry<BaseOidcModeClient>;
}

export interface BackendOidcModeCallbackResult {
	clientRecord: TokenSetClientReadyRecordView<BackendOidcModeClient>;
	snapshot: TokenSetAuthSnapshot;
}

export type BackendOidcModeCallbackHandle = OnceAsyncLockCallable<
	() => Promise<BackendOidcModeCallbackResult>
>;

export type BackendOidcModeCallbackState = OnceAsyncLock<
	BackendOidcModeCallbackResult,
	unknown
>;

export class BackendOidcModeCallbackController {
	handle: BackendOidcModeCallbackHandle;

	private readonly payload: () => CompatFragmentParameters;
	private readonly clientQuery: () => TokenSetClientQueryOptions;
	private readonly registry: () => TokenSetClientRegistry<BaseOidcModeClient>;

	constructor(options: BackendOidcModeCallbackOptions) {
		this.registry = options.registry;
		this.payload = options.payload;
		this.clientQuery = options.clientQuery;
		this.handle = this.createHandle();
	}

	get state(): ReadableSignalTrait<BackendOidcModeCallbackState> {
		return this.handle;
	}

	reset(): void {
		this.handle = this.createHandle();
	}

	private createHandle(): BackendOidcModeCallbackHandle {
		return createOnceAsyncLockCallable(async () => {
			const registry = this.registry();
			const record = this.selectClientRecordForInput(
				registry,
				this.clientQuery(),
			);
			if (!record) {
				throw new TokenSetClientRegistryError({
					code: TokenSetClientRegistryErrorCode.CallbackClientNotFound,
					message:
						"[BackendOidcModeCallbackController] Cannot determine which backend client this callback belongs to. Pass a matching clientQuery.",
				});
			}

			const readyRecord = await registry.initialize(
				record.get().meta.clientKey,
			);
			const client = readyRecord.client;
			if (!(client instanceof BackendOidcModeClient)) {
				throw new TokenSetClientRegistryError({
					code: TokenSetClientRegistryErrorCode.CallbackClientModeMismatch,
					clientKey: record.get().meta.clientKey,
					expectedMode: "BackendOidcModeClient",
					actualMode: client.constructor.name,
				});
			}
			const snapshot = await client.handleCallback(this.payload());

			return {
				clientRecord:
					readyRecord as TokenSetClientReadyRecordView<BackendOidcModeClient>,
				snapshot,
			};
		});
	}

	selectClientRecordForInput(
		registry: TokenSetClientRegistry<BaseOidcModeClient>,
		clientQuery: TokenSetClientQueryOptions,
	):
		| ReadableSignalTrait<TokenSetClientRecordView<BaseOidcModeClient>>
		| undefined {
		return registry.clientRecordForQuery(clientQuery);
	}
}
