import { useReadableSignal } from "@securitydept/client-react";
import {
	readTokenSetCallbackResumeErrorDetails,
	type TokenSetCallbackErrorPresenter,
	type TokenSetCallbackResumeController,
	type TokenSetCallbackResumeErrorDetails,
	type TokenSetCallbackResumeState,
	TokenSetCallbackResumeStatus,
} from "@securitydept/token-set-context-client/registry";
import { type ReactNode, useEffect, useRef } from "react";

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

export interface UseTokenSetCallbackResumeOptions<TService> {
	controller: TokenSetCallbackResumeController<TService>;
	getCurrentUrl?: () => string | null | undefined;
	describeError?: TokenSetCallbackErrorPresenter;
}

export const CallbackResumeStatus = TokenSetCallbackResumeStatus;
export type CallbackResumeStatus =
	(typeof CallbackResumeStatus)[keyof typeof CallbackResumeStatus];

export type CallbackResumeState = TokenSetCallbackResumeState;

export function useTokenSetCallbackResume<TService>(
	options: UseTokenSetCallbackResumeOptions<TService>,
): CallbackResumeState {
	const { describeError, getCurrentUrl } = options;
	const { controller } = options;
	const describeErrorRef = useRef(describeError);
	describeErrorRef.current = describeError;
	const currentUrl = getCurrentUrl?.() ?? null;
	const state = useReadableSignal(controller.state);

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

export interface TokenSetCallbackComponentProps<TService> {
	controller: TokenSetCallbackResumeController<TService>;
	pending?: ReactNode;
	fallback?: ReactNode;
	getCurrentUrl?: () => string | null | undefined;
	describeError?: TokenSetCallbackErrorPresenter;
	onResolved?: (result: {
		clientKey: string;
		postAuthRedirectUri: string | undefined;
	}) => void;
	onError?: (error: unknown) => void;
}

export function TokenSetCallbackComponent<TService>({
	controller,
	pending,
	fallback,
	getCurrentUrl,
	describeError,
	onResolved,
	onError,
}: TokenSetCallbackComponentProps<TService>): ReactNode {
	const state = useTokenSetCallbackResume({
		controller,
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
