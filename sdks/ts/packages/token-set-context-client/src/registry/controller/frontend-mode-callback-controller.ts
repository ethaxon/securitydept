import {
	createOnceAsyncLockCallable,
	type OnceAsyncLock,
	type OnceAsyncLockCallable,
	type ReadableSignalTrait,
} from "@securitydept/client";
import { FrontendOidcModeClient } from "../../frontend-oidc-mode";
import { type TokenSetAuthSnapshot } from "../../orchestration";
import { type BaseOidcModeClient } from "../../orchestration/client/base-client";
import { type TokenSetClientQueryOptions } from "../contracts/query";
import { type TokenSetClientReadyRecordView } from "../contracts/types";
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

export class FrontendOidcModeCallbackController {
	readonly handle: FrontendOidcModeCallbackHandle;

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
			this.registry().clientRecordForQuery(
				FrontendOidcModeCallbackController.createCallbackQuery(
					currentUrl,
					this.clientQuery(),
				),
			) !== undefined
		);
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

			const readyRecord = await registry.clientRecordForQuery(
				FrontendOidcModeCallbackController.createCallbackQuery(
					currentUrl,
					this.clientQuery(),
				),
				{ initialize: true },
			);
			if (!readyRecord) {
				throw new TokenSetClientRegistryError({
					code: TokenSetClientRegistryErrorCode.CallbackClientNotFound,
					currentUrl,
					message: `[FrontendOidcModeCallbackController] Cannot determine which frontend client this callback belongs to. URL: ${currentUrl}. Register callbackPath in the client entry or pass a matching clientQuery.`,
				});
			}

			const client = readyRecord.client;
			if (!(client instanceof FrontendOidcModeClient)) {
				throw new TokenSetClientRegistryError({
					code: TokenSetClientRegistryErrorCode.CallbackClientModeMismatch,
					clientKey: readyRecord.meta.clientKey,
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

	static createCallbackQuery(
		currentUrl: string,
		clientQuery: TokenSetClientQueryOptions | undefined,
	): TokenSetClientQueryOptions {
		if (!clientQuery) {
			return { callbackUrl: currentUrl };
		}

		return Array.isArray(clientQuery)
			? clientQuery.map((filter) => ({
					callbackUrl: currentUrl,
					...filter,
				}))
			: {
					callbackUrl: currentUrl,
					...clientQuery,
				};
	}
}
