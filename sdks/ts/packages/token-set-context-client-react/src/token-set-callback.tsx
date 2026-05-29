import {
	type ErrorPresentationDescriptor,
	OnceAsyncLockState,
} from "@securitydept/client";
import { useReadableSignalValue } from "@securitydept/client-react";
import {
	type FrontendOidcModeCallbackState,
	type ReadFrontendOidcModeCallbackErrorPresentationOptions,
	readFrontendOidcModeCallbackErrorPresentation,
} from "@securitydept/token-set-context-client/registry";
import { type ReactNode, useEffect, useRef } from "react";
import { type ReactTokenSetCallbackResumeController } from "./callback-resume-service";

export type CallbackResumeErrorDetails = ErrorPresentationDescriptor;

export type ReadCallbackResumeErrorDetailsOptions =
	ReadFrontendOidcModeCallbackErrorPresentationOptions;

export function readCallbackResumeErrorDetails(
	error: unknown,
	options: ReadCallbackResumeErrorDetailsOptions = {},
): CallbackResumeErrorDetails {
	return readFrontendOidcModeCallbackErrorPresentation(error, options);
}

export interface UseTokenSetCallbackResumeOptions {
	controller: ReactTokenSetCallbackResumeController;
	getCurrentUrl?: () => string | null | undefined;
	describeError?: (
		error: unknown,
		options?: ReadCallbackResumeErrorDetailsOptions,
	) => ErrorPresentationDescriptor;
}

export const CallbackResumeStatus = {
	Idle: OnceAsyncLockState.Init,
	Pending: OnceAsyncLockState.Running,
	Resolved: OnceAsyncLockState.Success,
	Error: OnceAsyncLockState.Error,
} as const;
export type CallbackResumeStatus =
	(typeof CallbackResumeStatus)[keyof typeof CallbackResumeStatus];

export type CallbackResumeState = FrontendOidcModeCallbackState;

export function useTokenSetCallbackResume(
	options: UseTokenSetCallbackResumeOptions,
): CallbackResumeState {
	const { getCurrentUrl } = options;
	const { controller } = options;
	const currentUrl = getCurrentUrl?.() ?? null;
	const state = useReadableSignalValue(controller.state);

	useEffect(() => {
		if (!currentUrl || !controller.isCallback({ currentUrl })) {
			controller.reset();
			return;
		}

		controller
			.handle({
				currentUrl,
			})
			.catch(() => {});
	}, [controller, currentUrl]);

	return state;
}

export interface TokenSetCallbackComponentProps {
	controller: ReactTokenSetCallbackResumeController;
	pending?: ReactNode;
	fallback?: ReactNode;
	getCurrentUrl?: () => string | null | undefined;
	describeError?: (
		error: unknown,
		options?: ReadCallbackResumeErrorDetailsOptions,
	) => ErrorPresentationDescriptor;
	onResolved?: (result: {
		clientKey: string;
		postAuthRedirectUri: string | undefined;
	}) => void;
	onError?: (error: unknown) => void;
}

export function TokenSetCallbackComponent({
	controller,
	pending,
	fallback,
	getCurrentUrl,
	describeError,
	onResolved,
	onError,
}: TokenSetCallbackComponentProps): ReactNode {
	const state = useTokenSetCallbackResume({
		controller,
		getCurrentUrl,
		describeError,
	});
	const resolvedRef = useRef(false);
	const erroredRef = useRef(false);

	useEffect(() => {
		if (
			state.state === CallbackResumeStatus.Resolved &&
			"data" in state &&
			!resolvedRef.current
		) {
			resolvedRef.current = true;
			onResolved?.({
				clientKey: state.data.clientRecord.meta.clientKey,
				postAuthRedirectUri: state.data.postAuthRedirectUri,
			});
		}
		if (state.state === CallbackResumeStatus.Error && !erroredRef.current) {
			erroredRef.current = true;
			onError?.(state.error);
		}
	}, [state, onResolved, onError]);

	if (state.state === CallbackResumeStatus.Pending) {
		return pending ?? null;
	}
	if (state.state === CallbackResumeStatus.Idle) {
		return fallback ?? null;
	}
	if (state.state === CallbackResumeStatus.Error) {
		return fallback ?? null;
	}
	return null;
}
