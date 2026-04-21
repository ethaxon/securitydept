import {
	ClientError,
	type ClientErrorKind,
	type ErrorPresentationDescriptor,
	fromPromise,
	PromiseSettlementKind,
	UserRecovery,
	type UserRecovery as UserRecoveryType,
} from "@securitydept/client";
import { describeFrontendOidcModeCallbackError } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
	type ReactRegistry,
	useTokenSetAuthRegistry,
} from "./token-set-auth-provider";

const callbackResumeCache = new WeakMap<
	ReactRegistry,
	Map<
		string,
		Promise<{
			clientKey: string;
			result: { snapshot: unknown; postAuthRedirectUri?: string };
		}>
	>
>();

function resumeCallbackOnce(
	registry: ReactRegistry,
	clientKey: string,
	currentUrl: string,
): Promise<{
	clientKey: string;
	result: { snapshot: unknown; postAuthRedirectUri?: string };
}> {
	let cache = callbackResumeCache.get(registry);
	if (!cache) {
		cache = new Map();
		callbackResumeCache.set(registry, cache);
	}

	const cacheKey = `${clientKey}::${currentUrl}`;
	const existing = cache.get(cacheKey);
	if (existing) {
		return existing;
	}

	let resumePromise: Promise<{
		clientKey: string;
		result: { snapshot: unknown; postAuthRedirectUri?: string };
	}>;
	resumePromise = (async () => {
		const service = await registry.whenReady(clientKey);
		const result = await service.client.handleCallback(currentUrl);
		return { clientKey, result };
	})().finally(() => {
		const currentCache = callbackResumeCache.get(registry);
		if (!currentCache) {
			return;
		}
		if (currentCache.get(cacheKey) === resumePromise) {
			currentCache.delete(cacheKey);
			if (currentCache.size === 0) {
				callbackResumeCache.delete(registry);
			}
		}
	});

	cache.set(cacheKey, resumePromise);
	return resumePromise;
}

export function disposeCallbackResumeCache(registry: ReactRegistry): void {
	callbackResumeCache.delete(registry);
}

export interface CallbackResumeErrorDetails {
	code: string | null;
	kind: ClientErrorKind | null;
	message: string;
	recovery: UserRecoveryType;
	retryable: boolean;
	source?: string;
	presentation: ErrorPresentationDescriptor;
	cause: unknown;
}

export function readCallbackResumeErrorDetails(
	error: unknown,
): CallbackResumeErrorDetails {
	if (error instanceof ClientError) {
		const normalized = {
			code: error.code,
			kind: error.kind,
			message: error.message,
			recovery: error.recovery,
			retryable: error.retryable,
			source: error.source,
		};
		return {
			...normalized,
			presentation: describeFrontendOidcModeCallbackError(normalized),
			cause: error,
		};
	}

	if (error instanceof Error) {
		const normalized = {
			code: null,
			kind: null,
			message: error.message,
			recovery: UserRecovery.None,
			retryable: false,
		};
		return {
			...normalized,
			presentation: describeFrontendOidcModeCallbackError(normalized),
			cause: error,
		};
	}

	const normalized = {
		code: null,
		kind: null,
		message: "Unknown callback error",
		recovery: UserRecovery.None,
		retryable: false,
	};
	return {
		...normalized,
		presentation: describeFrontendOidcModeCallbackError(normalized),
		cause: error,
	};
}

export interface UseTokenSetCallbackResumeOptions {
	getCurrentUrl?: () => string | undefined;
}

export const CallbackResumeStatus = {
	Idle: "idle",
	Pending: "pending",
	Resolved: "resolved",
	Error: "error",
} as const;
export type CallbackResumeStatus =
	(typeof CallbackResumeStatus)[keyof typeof CallbackResumeStatus];

export interface CallbackResumeState {
	clientKey: string | null;
	status: CallbackResumeStatus;
	result: { snapshot: unknown; postAuthRedirectUri?: string } | null;
	error: unknown;
	errorDetails: CallbackResumeErrorDetails | null;
}

export function useTokenSetCallbackResume(
	options: UseTokenSetCallbackResumeOptions = {},
): CallbackResumeState {
	const registry = useTokenSetAuthRegistry();
	const currentUrl =
		options.getCurrentUrl?.() ??
		(typeof window !== "undefined" ? window.location.href : undefined);

	const clientKey = useMemo(() => {
		if (!currentUrl) return null;
		return registry.clientKeyForCallback(currentUrl) ?? null;
	}, [registry, currentUrl]);

	const [state, setState] = useState<CallbackResumeState>(() => ({
		clientKey,
		status:
			clientKey && currentUrl
				? CallbackResumeStatus.Pending
				: CallbackResumeStatus.Idle,
		result: null,
		error: null,
		errorDetails: null,
	}));

	useEffect(() => {
		if (!clientKey || !currentUrl) {
			setState({
				clientKey: null,
				status: CallbackResumeStatus.Idle,
				result: null,
				error: null,
				errorDetails: null,
			});
			return;
		}
		let cancelled = false;
		setState({
			clientKey,
			status: CallbackResumeStatus.Pending,
			result: null,
			error: null,
			errorDetails: null,
		});
		const subscription = fromPromise({
			promise: resumeCallbackOnce(registry, clientKey, currentUrl),
			callback: (settlement) => {
				if (cancelled) {
					return;
				}

				if (settlement.kind === PromiseSettlementKind.Fulfilled) {
					setState({
						clientKey,
						status: CallbackResumeStatus.Resolved,
						result: settlement.value.result,
						error: null,
						errorDetails: null,
					});
					return;
				}

				setState({
					clientKey,
					status: CallbackResumeStatus.Error,
					result: null,
					error: settlement.reason,
					errorDetails: readCallbackResumeErrorDetails(settlement.reason),
				});
			},
		});
		return () => {
			cancelled = true;
			subscription.unsubscribe();
		};
	}, [registry, clientKey, currentUrl]);

	return state;
}

export interface TokenSetCallbackComponentProps {
	pending?: ReactNode;
	fallback?: ReactNode;
	onResolved?: (result: {
		clientKey: string;
		postAuthRedirectUri: string | undefined;
	}) => void;
	onError?: (error: unknown) => void;
}

export function TokenSetCallbackComponent({
	pending,
	fallback,
	onResolved,
	onError,
}: TokenSetCallbackComponentProps): ReactNode {
	const state = useTokenSetCallbackResume();
	const resolvedRef = useRef(false);
	const erroredRef = useRef(false);

	useEffect(() => {
		if (
			state.status === CallbackResumeStatus.Resolved &&
			state.clientKey &&
			!resolvedRef.current
		) {
			resolvedRef.current = true;
			onResolved?.({
				clientKey: state.clientKey,
				postAuthRedirectUri: state.result?.postAuthRedirectUri,
			});
		}
		if (state.status === CallbackResumeStatus.Error && !erroredRef.current) {
			erroredRef.current = true;
			onError?.(state.error);
		}
	}, [state, onResolved, onError]);

	if (state.status === CallbackResumeStatus.Pending) {
		return pending ?? null;
	}
	if (state.status === CallbackResumeStatus.Idle) {
		return fallback ?? null;
	}
	if (state.status === CallbackResumeStatus.Error) {
		return fallback ?? null;
	}
	return null;
}
