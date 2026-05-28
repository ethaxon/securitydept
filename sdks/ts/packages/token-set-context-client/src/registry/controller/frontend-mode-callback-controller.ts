import {
	createOnceAsyncLockCallable,
	type DisposableTrait,
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
import { type ClientFilter, type ClientQueryOptions } from "../contracts/query";
import { type ClientReadyRecordView } from "../contracts/types";
import { type ClientRecord } from "../core/client-record";
import { type ClientRegistry } from "../core/client-registry";
import { ClientRegistryError, ClientRegistryErrorCode } from "../core/error";

export interface FrontendOidcModeCallbackInput {
	currentUrl: string;
	clientQuery?: ClientQueryOptions;
}

export interface FrontendOidcModeCallbackOptions
	extends FrontendOidcModeCallbackInput {
	registry: ClientRegistry<DisposableTrait>;
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

	private readonly currentUrl: string;
	private readonly clientQuery: ClientQueryOptions | undefined;
	private readonly registry: ClientRegistry<DisposableTrait>;

	constructor(options: FrontendOidcModeCallbackOptions) {
		this.registry = options.registry;
		this.currentUrl = options.currentUrl;
		this.clientQuery = options.clientQuery;
		this.handle = this.createHandle();
	}

	get state(): ReadableSignalTrait<FrontendOidcModeCallbackState> {
		return this.handle;
	}

	isCallback(): boolean {
		return this.selectClientRecord() !== undefined;
	}

	reset(): void {
		this.handle = this.createHandle();
	}

	private createHandle(): FrontendOidcModeCallbackHandle {
		return createOnceAsyncLockCallable(async () => {
			const record = this.selectClientRecord();
			if (!record) {
				throw new ClientRegistryError({
					code: ClientRegistryErrorCode.CallbackClientNotFound,
					currentUrl: this.currentUrl,
					message: `[FrontendOidcModeCallbackController] Cannot determine which frontend client this callback belongs to. URL: ${this.currentUrl}. Register callbackPath in the client entry or pass a matching clientQuery.`,
				});
			}

			const client = await this.registry.initialize(
				record.get().meta.clientKey,
			);
			if (!(client instanceof FrontendOidcModeClient)) {
				throw new ClientRegistryError({
					code: ClientRegistryErrorCode.CallbackClientModeMismatch,
					clientKey: record.get().meta.clientKey,
					expectedMode: "FrontendOidcModeClient",
					actualMode: client.constructor.name,
				});
			}
			const callbackResult = await client.handleCallback(this.currentUrl);

			return {
				clientRecord: record
					.get()
					.toView() as ClientReadyRecordView<FrontendOidcModeClient>,
				snapshot: callbackResult.snapshot,
				postAuthRedirectUri: callbackResult.postAuthRedirectUri,
			};
		});
	}

	selectClientRecord():
		| ReadableSignalTrait<ClientRecord<DisposableTrait>>
		| undefined {
		return this.registry.clientRecordForQuery(
			FrontendOidcModeCallbackController.createCallbackQuery(
				this.currentUrl,
				this.clientQuery,
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
