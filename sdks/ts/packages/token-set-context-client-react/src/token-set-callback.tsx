import {
	readTokenSetCallbackResumeErrorDetails,
	type TokenSetCallbackErrorPresenter,
	type TokenSetCallbackResumeErrorDetails,
	type TokenSetCallbackResumeState,
	TokenSetCallbackResumeStatus,
} from "@securitydept/token-set-context-client/registry";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useSyncExternalStore,
} from "react";
import { useTokenSetCallbackResumeController } from "./token-set-auth-provider";

export type CallbackResumeErrorDetails = TokenSetCallbackResumeErrorDetails;

export interface ReadCallbackResumeErrorDetailsOptions {
	clientKey?: string | null;
	currentUrl?: string;
	describeError?: TokenSetCallbackErrorPresenter;
}

export function readCallbackResumeErrorDetails(
	error: unknown,
	options: ReadCallbackResumeErrorDetailsOptions = {},
): CallbackResumeErrorDetails {
	return readTokenSetCallbackResumeErrorDetails(error, options);
}

export interface UseTokenSetCallbackResumeOptions {
	getCurrentUrl?: () => string | undefined;
	describeError?: TokenSetCallbackErrorPresenter;
}

export const CallbackResumeStatus = TokenSetCallbackResumeStatus;
export type CallbackResumeStatus =
	(typeof CallbackResumeStatus)[keyof typeof CallbackResumeStatus];

export type CallbackResumeState = TokenSetCallbackResumeState;

export function useTokenSetCallbackResume(
	options: UseTokenSetCallbackResumeOptions = {},
): CallbackResumeState {
	const controller = useTokenSetCallbackResumeController();
	const { describeError, getCurrentUrl } = options;
	const describeErrorRef = useRef(describeError);
	describeErrorRef.current = describeError;
	const currentUrl =
		getCurrentUrl?.() ??
		(typeof window !== "undefined" ? window.location.href : undefined);

	const state = useSyncExternalStore(
		useCallback((listener) => controller.subscribe(listener), [controller]),
		useCallback(() => controller.getState(), [controller]),
		useCallback(() => controller.getState(), [controller]),
	);

	useEffect(() => {
		if (!currentUrl || !controller.isCallback(currentUrl)) {
			controller.reset();
			return;
		}

		controller
			.resume({
				currentUrl,
				describeError: describeErrorRef.current,
			})
			.catch(() => {});
	}, [controller, currentUrl]);

	return state;
}

export interface TokenSetCallbackComponentProps {
	pending?: ReactNode;
	fallback?: ReactNode;
	getCurrentUrl?: () => string | undefined;
	describeError?: TokenSetCallbackErrorPresenter;
	onResolved?: (result: {
		clientKey: string;
		postAuthRedirectUri: string | undefined;
	}) => void;
	onError?: (error: unknown) => void;
}

export function TokenSetCallbackComponent({
	pending,
	fallback,
	getCurrentUrl,
	describeError,
	onResolved,
	onError,
}: TokenSetCallbackComponentProps): ReactNode {
	const state = useTokenSetCallbackResume({
		getCurrentUrl,
		describeError,
	});
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
