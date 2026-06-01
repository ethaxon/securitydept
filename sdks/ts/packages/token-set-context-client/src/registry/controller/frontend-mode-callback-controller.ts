import {
	createOnceAsyncLockCallable,
	type ErrorPresentationDescriptor,
	ErrorPresentationTone,
	type OnceAsyncLock,
	type OnceAsyncLockCallable,
	type ReadableSignalTrait,
	type ReadErrorPresentationDescriptorOptions,
	readErrorPresentationDescriptor,
	UserRecovery,
} from "@securitydept/client";
import { FrontendOidcModeClient } from "../../frontend-oidc-mode";
import { type AuthSnapshot } from "../../orchestration";
import { type BaseOidcModeClient } from "../../orchestration/client/base-client";
import { type ClientFilter, type ClientQueryOptions } from "../contracts/query";
import { type ClientReadyRecordView } from "../contracts/types";
import { type ClientRecord } from "../core/client-record";
import { type ClientRegistry } from "../core/client-registry";
import { ClientRegistryError, ClientRegistryErrorCode } from "../core/error";

export interface FrontendOidcModeCallbackInput {
	currentUrl: () => string | null | undefined;
	clientQuery?: () => ClientQueryOptions | undefined;
}

export interface FrontendOidcModeCallbackOptions
	extends FrontendOidcModeCallbackInput {
	registry: () => ClientRegistry<BaseOidcModeClient>;
}

export interface FrontendOidcModeCallbackResult {
	clientRecord: ClientReadyRecordView<FrontendOidcModeClient>;
	snapshot: AuthSnapshot;
	postAuthRedirectUri?: string;
}

export type FrontendOidcModeCallbackHandle = OnceAsyncLockCallable<
	() => Promise<FrontendOidcModeCallbackResult>
>;

export type FrontendOidcModeCallbackState = OnceAsyncLock<
	FrontendOidcModeCallbackResult,
	unknown
>;

export interface ReadFrontendOidcModeCallbackErrorPresentationOptions
	extends ReadErrorPresentationDescriptorOptions {
	clientKey?: string | null;
	currentUrl?: string;
}

export function readFrontendOidcModeCallbackErrorPresentation(
	error: unknown,
	options: ReadFrontendOidcModeCallbackErrorPresentationOptions = {},
): ErrorPresentationDescriptor {
	const descriptor = readErrorPresentationDescriptor(error, {
		fallbackTitle: "Authentication callback failed",
		fallbackDescription:
			"The frontend OIDC callback could not be completed by the registered token-set client. Restart the sign-in flow from this application.",
		...options,
	});

	return {
		...descriptor,
		title: "Authentication callback failed",
		tone:
			descriptor.retryable || descriptor.recovery === UserRecovery.RestartFlow
				? ErrorPresentationTone.Warning
				: descriptor.tone,
	};
}

export class FrontendOidcModeCallbackController {
	handle: FrontendOidcModeCallbackHandle;

	private readonly currentUrl: () => string | null | undefined;
	private readonly clientQuery: () => ClientQueryOptions | undefined;
	private readonly registry: () => ClientRegistry<BaseOidcModeClient>;

	constructor(options: FrontendOidcModeCallbackOptions) {
		this.registry = options.registry;
		this.currentUrl = options.currentUrl;
		this.clientQuery = options.clientQuery ?? (() => undefined);
		this.handle = this.createHandle();
	}

	get state(): ReadableSignalTrait<FrontendOidcModeCallbackState> {
		return this.handle;
	}

	isCallback(): boolean {
		const currentUrl = this.currentUrl();
		if (currentUrl == null) {
			return false;
		}
		return (
			this.selectClientRecordForInput(
				this.registry(),
				currentUrl,
				this.clientQuery(),
			) !== undefined
		);
	}

	reset(): void {
		this.handle = this.createHandle();
	}

	private createHandle(): FrontendOidcModeCallbackHandle {
		return createOnceAsyncLockCallable(async () => {
			const registry = this.registry();
			const currentUrl = this.currentUrl();
			if (currentUrl == null) {
				throw new ClientRegistryError({
					code: ClientRegistryErrorCode.CallbackClientNotFound,
					currentUrl: undefined,
					message:
						"[FrontendOidcModeCallbackController] Cannot determine which frontend client this callback belongs to. URL: <unavailable>. Register callbackPath in the client entry or pass a matching clientQuery.",
				});
			}

			const record = this.selectClientRecordForInput(
				registry,
				currentUrl,
				this.clientQuery(),
			);
			if (!record) {
				throw new ClientRegistryError({
					code: ClientRegistryErrorCode.CallbackClientNotFound,
					currentUrl,
					message: `[FrontendOidcModeCallbackController] Cannot determine which frontend client this callback belongs to. URL: ${currentUrl}. Register callbackPath in the client entry or pass a matching clientQuery.`,
				});
			}

			const readyRecord = await registry.initialize(
				record.get().meta.clientKey,
			);
			const client = readyRecord.client;
			if (!(client instanceof FrontendOidcModeClient)) {
				throw new ClientRegistryError({
					code: ClientRegistryErrorCode.CallbackClientModeMismatch,
					clientKey: record.get().meta.clientKey,
					expectedMode: "FrontendOidcModeClient",
					actualMode: client.constructor.name,
				});
			}
			const callbackResult = await client.handleCallback(currentUrl);

			return {
				clientRecord:
					readyRecord as ClientReadyRecordView<FrontendOidcModeClient>,
				snapshot: callbackResult.snapshot,
				postAuthRedirectUri: callbackResult.postAuthRedirectUri,
			};
		});
	}

	selectClientRecordForInput(
		registry: ClientRegistry<BaseOidcModeClient>,
		currentUrl: string,
		clientQuery: ClientQueryOptions | undefined,
	): ReadableSignalTrait<ClientRecord<BaseOidcModeClient>> | undefined {
		return registry.clientRecordForQuery(
			FrontendOidcModeCallbackController.createCallbackQuery(
				currentUrl,
				clientQuery,
			),
		);
	}

	static createCallbackQuery(
		currentUrl: string,
		clientQuery: ClientQueryOptions | undefined,
	): ClientQueryOptions {
		if (!clientQuery) {
			return { callbackUrl: currentUrl };
		}

		function withCallbackUrl(filter: ClientFilter): ClientFilter {
			return {
				callbackUrl: currentUrl,
				...filter,
			};
		}

		return Array.isArray(clientQuery)
			? clientQuery.map(withCallbackUrl)
			: withCallbackUrl(clientQuery);
	}
}
