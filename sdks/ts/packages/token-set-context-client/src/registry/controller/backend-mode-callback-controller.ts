import {
	createOnceAsyncLockCallable,
	type DisposableTrait,
	type OnceAsyncLock,
	type OnceAsyncLockCallable,
	type ReadableSignalTrait,
} from "@securitydept/client";
import { BackendOidcModeClient } from "../../backend-oidc-mode";
import { type AuthSnapshot } from "../../orchestration";
import { type ClientQueryOptions } from "../contracts/query";
import { type ClientReadyRecordView } from "../contracts/types";
import { type ClientRecord } from "../core/client-record";
import { type ClientRegistry } from "../core/client-registry";
import { ClientRegistryError, ClientRegistryErrorCode } from "../core/error";

export interface BackendOidcModeCallbackInput {
	payload: Record<string, unknown>;
	clientQuery: ClientQueryOptions;
}

export interface BackendOidcModeCallbackOptions
	extends BackendOidcModeCallbackInput {
	registry: ClientRegistry<DisposableTrait>;
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

	private readonly payload: Record<string, unknown>;
	private readonly clientQuery: ClientQueryOptions;
	private readonly registry: ClientRegistry<DisposableTrait>;

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
			const record = this.selectClientRecord();
			if (!record) {
				throw new ClientRegistryError({
					code: ClientRegistryErrorCode.CallbackClientNotFound,
					message:
						"[BackendOidcModeCallbackController] Cannot determine which backend client this callback belongs to. Pass a matching clientQuery.",
				});
			}

			const client = await this.registry.initialize(
				record.get().meta.clientKey,
			);
			if (!(client instanceof BackendOidcModeClient)) {
				throw new ClientRegistryError({
					code: ClientRegistryErrorCode.CallbackClientModeMismatch,
					clientKey: record.get().meta.clientKey,
					expectedMode: "BackendOidcModeClient",
					actualMode: client.constructor.name,
				});
			}
			const snapshot = await client.handleCallback(this.payload);

			return {
				clientRecord: record
					.get()
					.toView() as ClientReadyRecordView<BackendOidcModeClient>,
				snapshot,
			};
		});
	}

	selectClientRecord():
		| ReadableSignalTrait<ClientRecord<DisposableTrait>>
		| undefined {
		return this.registry.clientRecordForQuery(this.clientQuery);
	}
}
