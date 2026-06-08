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
import { type TokenSetClientReadyRecordView } from "../contracts/types";
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
	readonly handle: BackendOidcModeCallbackHandle;

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

	private createHandle(): BackendOidcModeCallbackHandle {
		return createOnceAsyncLockCallable(async () => {
			const registry = this.registry();
			const readyRecord = await registry.clientRecordForQuery(
				this.clientQuery(),
				{ initialize: true },
			);
			if (!readyRecord) {
				throw new TokenSetClientRegistryError({
					code: TokenSetClientRegistryErrorCode.CallbackClientNotFound,
					message:
						"[BackendOidcModeCallbackController] Cannot determine which backend client this callback belongs to. Pass a matching clientQuery.",
				});
			}

			const client = readyRecord.client;
			if (!(client instanceof BackendOidcModeClient)) {
				throw new TokenSetClientRegistryError({
					code: TokenSetClientRegistryErrorCode.CallbackClientModeMismatch,
					clientKey: readyRecord.meta.clientKey,
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
}
