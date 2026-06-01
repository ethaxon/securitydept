import {
	type CompatFragmentParameters,
	createOnceAsyncLockCallable,
	type OnceAsyncLock,
	type OnceAsyncLockCallable,
	type ReadableSignalTrait,
} from "@securitydept/client";
import { BackendOidcModeClient } from "../../backend-oidc-mode";
import { type AuthSnapshot } from "../../orchestration";
import { type BaseOidcModeClient } from "../../orchestration/client/base-client";
import { type ClientQueryOptions } from "../contracts/query";
import { type ClientReadyRecordView } from "../contracts/types";
import { type ClientRecord } from "../core/client-record";
import { type ClientRegistry } from "../core/client-registry";
import { ClientRegistryError, ClientRegistryErrorCode } from "../core/error";

export interface BackendOidcModeCallbackInput {
	payload: () => CompatFragmentParameters;
	clientQuery: () => ClientQueryOptions;
}

export interface BackendOidcModeCallbackOptions
	extends BackendOidcModeCallbackInput {
	registry: () => ClientRegistry<BaseOidcModeClient>;
}

export interface BackendOidcModeCallbackResult {
	clientRecord: ClientReadyRecordView<BackendOidcModeClient>;
	snapshot: AuthSnapshot;
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
	private readonly clientQuery: () => ClientQueryOptions;
	private readonly registry: () => ClientRegistry<BaseOidcModeClient>;

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
				throw new ClientRegistryError({
					code: ClientRegistryErrorCode.CallbackClientNotFound,
					message:
						"[BackendOidcModeCallbackController] Cannot determine which backend client this callback belongs to. Pass a matching clientQuery.",
				});
			}

			const readyRecord = await registry.initialize(
				record.get().meta.clientKey,
			);
			const client = readyRecord.client;
			if (!(client instanceof BackendOidcModeClient)) {
				throw new ClientRegistryError({
					code: ClientRegistryErrorCode.CallbackClientModeMismatch,
					clientKey: record.get().meta.clientKey,
					expectedMode: "BackendOidcModeClient",
					actualMode: client.constructor.name,
				});
			}
			const snapshot = await client.handleCallback(this.payload());

			return {
				clientRecord:
					readyRecord as ClientReadyRecordView<BackendOidcModeClient>,
				snapshot,
			};
		});
	}

	selectClientRecordForInput(
		registry: ClientRegistry<BaseOidcModeClient>,
		clientQuery: ClientQueryOptions,
	): ReadableSignalTrait<ClientRecord<BaseOidcModeClient>> | undefined {
		return registry.clientRecordForQuery(clientQuery);
	}
}
