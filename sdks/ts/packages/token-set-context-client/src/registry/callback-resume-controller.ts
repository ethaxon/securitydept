import {
	createSignal,
	type ReadableSignalTrait,
	readonlySignal,
} from "@securitydept/client";
import type { AuthSnapshot } from "../orchestration";
import {
	readTokenSetCallbackResumeErrorDetails,
	type TokenSetCallbackErrorPresenter,
	type TokenSetCallbackResumeErrorDetails,
} from "./error-presentation";
import type { OidcCallbackClient } from "./types";

export interface TokenSetCallbackResumeRegistry<TService> {
	clientKeyForCallback(url: string): string | undefined;
	whenReady(key: string): Promise<TService>;
}

export interface TokenSetCallbackResumeControllerOptions<TService> {
	registry: TokenSetCallbackResumeRegistry<TService>;
	getCallbackClient: (service: TService) => OidcCallbackClient;
}

export interface TokenSetCallbackResumeOptions {
	currentUrl: string;
	clientKey?: string;
	describeError?: TokenSetCallbackErrorPresenter;
}

export interface TokenSetCallbackResumeResult {
	clientKey: string;
	snapshot: AuthSnapshot;
	postAuthRedirectUri?: string;
}

export const TokenSetCallbackResumeStatus = {
	Idle: "idle",
	Pending: "pending",
	Resolved: "resolved",
	Error: "error",
} as const;

export type TokenSetCallbackResumeStatus =
	(typeof TokenSetCallbackResumeStatus)[keyof typeof TokenSetCallbackResumeStatus];

export interface TokenSetCallbackResumeState {
	clientKey: string | null;
	status: TokenSetCallbackResumeStatus;
	result: TokenSetCallbackResumeResult | null;
	error: unknown;
	errorDetails: TokenSetCallbackResumeErrorDetails | null;
}

export class TokenSetCallbackResumeController<TService> {
	readonly state: ReadableSignalTrait<TokenSetCallbackResumeState>;

	private readonly registry: TokenSetCallbackResumeRegistry<TService>;
	private readonly getCallbackClient: (service: TService) => OidcCallbackClient;
	private readonly stateSignal = createSignal<TokenSetCallbackResumeState>({
		clientKey: null,
		status: TokenSetCallbackResumeStatus.Idle,
		result: null,
		error: null,
		errorDetails: null,
	});
	private readonly resumeCache = new Map<
		string,
		Promise<TokenSetCallbackResumeResult>
	>();
	private disposed = false;

	constructor(options: TokenSetCallbackResumeControllerOptions<TService>) {
		this.registry = options.registry;
		this.getCallbackClient = options.getCallbackClient;
		this.state = readonlySignal(this.stateSignal);
	}

	isCallback(url: string): boolean {
		return this.registry.clientKeyForCallback(url) !== undefined;
	}

	getState(): TokenSetCallbackResumeState {
		return this.stateSignal.get();
	}

	subscribe(listener: () => void): () => void {
		return this.stateSignal.subscribe(listener);
	}

	resume(
		options: TokenSetCallbackResumeOptions,
	): Promise<TokenSetCallbackResumeResult> {
		if (this.disposed) {
			return Promise.reject(
				new Error(
					"[TokenSetCallbackResumeController] Cannot resume callback after controller has been disposed.",
				),
			);
		}

		const clientKey =
			options.clientKey ??
			this.registry.clientKeyForCallback(options.currentUrl) ??
			null;
		if (!clientKey) {
			const error = new Error(
				`[TokenSetCallbackResumeController] Cannot determine which client this callback belongs to. URL: ${options.currentUrl}. Register callbackPath in the client entry.`,
			);
			this.stateSignal.set({
				clientKey: null,
				status: TokenSetCallbackResumeStatus.Error,
				result: null,
				error,
				errorDetails: readTokenSetCallbackResumeErrorDetails(error, {
					clientKey: null,
					currentUrl: options.currentUrl,
					describeError: options.describeError,
				}),
			});
			return Promise.reject(error);
		}

		const cacheKey = `${clientKey}::${options.currentUrl}`;
		const cached = this.resumeCache.get(cacheKey);
		if (cached) {
			return cached;
		}

		this.stateSignal.set({
			clientKey,
			status: TokenSetCallbackResumeStatus.Pending,
			result: null,
			error: null,
			errorDetails: null,
		});

		const promise = this.registry
			.whenReady(clientKey)
			.then((service) =>
				this.getCallbackClient(service).handleCallback(options.currentUrl),
			)
			.then((result) => {
				const resumeResult: TokenSetCallbackResumeResult = {
					clientKey,
					snapshot: result.snapshot,
					postAuthRedirectUri: result.postAuthRedirectUri,
				};
				if (!this.disposed) {
					this.stateSignal.set({
						clientKey,
						status: TokenSetCallbackResumeStatus.Resolved,
						result: resumeResult,
						error: null,
						errorDetails: null,
					});
				}
				return resumeResult;
			})
			.catch((error: unknown) => {
				if (!this.disposed) {
					this.stateSignal.set({
						clientKey,
						status: TokenSetCallbackResumeStatus.Error,
						result: null,
						error,
						errorDetails: readTokenSetCallbackResumeErrorDetails(error, {
							clientKey,
							currentUrl: options.currentUrl,
							describeError: options.describeError,
						}),
					});
				}
				throw error;
			});

		this.resumeCache.set(cacheKey, promise);
		return promise;
	}

	reset(): void {
		if (this.disposed) {
			return;
		}

		this.resumeCache.clear();
		this.stateSignal.set({
			clientKey: null,
			status: TokenSetCallbackResumeStatus.Idle,
			result: null,
			error: null,
			errorDetails: null,
		});
	}

	dispose(): void {
		this.disposed = true;
		this.resumeCache.clear();
	}
}
