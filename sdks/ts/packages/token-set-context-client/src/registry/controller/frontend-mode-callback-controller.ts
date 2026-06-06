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
import { type TokenSetAuthSnapshot } from "../../orchestration";
import { type BaseOidcModeClient } from "../../orchestration/client/base-client";
import {
	type TokenSetClientFilter,
	type TokenSetClientQueryOptions,
} from "../contracts/query";
import {
	type TokenSetClientReadyRecordView,
	type TokenSetClientRecordView,
} from "../contracts/types";
import { type TokenSetClientRegistry } from "../core/client-registry";
import {
	TokenSetClientRegistryError,
	TokenSetClientRegistryErrorCode,
} from "../core/error";

export interface FrontendOidcModeCallbackInput {
	currentUrl: () => string | null | undefined;
	clientQuery?: () => TokenSetClientQueryOptions | undefined;
}

export interface FrontendOidcModeCallbackOptions
	extends FrontendOidcModeCallbackInput {
	registry: () => TokenSetClientRegistry<BaseOidcModeClient>;
}

export interface FrontendOidcModeCallbackResult {
	clientRecord: TokenSetClientReadyRecordView<FrontendOidcModeClient>;
	snapshot: TokenSetAuthSnapshot;
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
	private readonly clientQuery: () => TokenSetClientQueryOptions | undefined;
	private readonly registry: () => TokenSetClientRegistry<BaseOidcModeClient>;

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
				throw new TokenSetClientRegistryError({
					code: TokenSetClientRegistryErrorCode.CallbackClientNotFound,
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
				throw new TokenSetClientRegistryError({
					code: TokenSetClientRegistryErrorCode.CallbackClientNotFound,
					currentUrl,
					message: `[FrontendOidcModeCallbackController] Cannot determine which frontend client this callback belongs to. URL: ${currentUrl}. Register callbackPath in the client entry or pass a matching clientQuery.`,
				});
			}

			const readyRecord = await registry.initialize(
				record.get().meta.clientKey,
			);
			const client = readyRecord.client;
			if (!(client instanceof FrontendOidcModeClient)) {
				throw new TokenSetClientRegistryError({
					code: TokenSetClientRegistryErrorCode.CallbackClientModeMismatch,
					clientKey: record.get().meta.clientKey,
					expectedMode: "FrontendOidcModeClient",
					actualMode: client.constructor.name,
				});
			}
			const callbackResult = await client.handleCallback(currentUrl);

			return {
				clientRecord:
					readyRecord as TokenSetClientReadyRecordView<FrontendOidcModeClient>,
				snapshot: callbackResult.snapshot,
				postAuthRedirectUri: callbackResult.postAuthRedirectUri,
			};
		});
	}

	selectClientRecordForInput(
		registry: TokenSetClientRegistry<BaseOidcModeClient>,
		currentUrl: string,
		clientQuery: TokenSetClientQueryOptions | undefined,
	):
		| ReadableSignalTrait<TokenSetClientRecordView<BaseOidcModeClient>>
		| undefined {
		return registry.clientRecordForQuery(
			FrontendOidcModeCallbackController.createCallbackQuery(
				currentUrl,
				clientQuery,
			),
		);
	}

	static createCallbackQuery(
		currentUrl: string,
		clientQuery: TokenSetClientQueryOptions | undefined,
	): TokenSetClientQueryOptions {
		if (!clientQuery) {
			return { callbackUrl: currentUrl };
		}

		function withCallbackUrl(
			filter: TokenSetClientFilter,
		): TokenSetClientFilter {
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
