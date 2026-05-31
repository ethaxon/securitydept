import { type CancellationTokenTrait } from "../../cancellation";
import {
	type DisposableTrait,
	SYMBOL_DISPOSE,
	SYMBOL_OBSERVABLE,
} from "../../compat";
import { ClientError } from "../../errors/client-error";
import { ClientErrorKind, ClientErrorSource } from "../../errors/types";
import { abortSignalToEventStream } from "../events";

/**
 * Bridge a web `AbortSignal` back into the foundation cancellation contract.
 *
 * This is the canonical consumer-side path for browser hosts that receive an
 * `AbortSignal` from framework/runtime APIs (for example React Query queryFns)
 * but need to call SDK surfaces that accept `CancellationTokenTrait`.
 */
export function abortSignalToCancellationToken(
	signal: AbortSignal,
): CancellationTokenTrait;
export function abortSignalToCancellationToken(signal?: undefined): undefined;
export function abortSignalToCancellationToken(
	signal?: AbortSignal,
): CancellationTokenTrait | undefined;
export function abortSignalToCancellationToken(
	signal?: AbortSignal,
): CancellationTokenTrait | undefined {
	if (!signal) {
		return undefined;
	}

	return {
		get isCancellationRequested() {
			return signal.aborted;
		},
		get reason() {
			return signal.reason;
		},
		onCancellationRequested(listener: (reason: unknown) => void) {
			const subscription = abortSignalToEventStream(signal).subscribe({
				next: listener,
			});
			return {
				dispose() {
					subscription.unsubscribe();
				},
				[SYMBOL_DISPOSE]: () => {
					subscription.unsubscribe();
				},
			};
		},
		subscribe(observer) {
			return abortSignalToEventStream(signal).subscribe(observer);
		},
		[SYMBOL_OBSERVABLE]() {
			return abortSignalToEventStream(signal);
		},
		throwIfCancellationRequested() {
			if (signal.aborted) {
				throw new ClientError({
					kind: ClientErrorKind.Cancelled,
					message: "Request was cancelled via AbortSignal",
					code: "client.cancelled",
					source: ClientErrorSource.Transport,
					cause: signal.reason,
				});
			}
		},
		readCancellationError() {
			try {
				this.throwIfCancellationRequested();
			} catch (error) {
				return error;
			}
			return signal.reason;
		},
	};
}

export interface AbortSignalBridge extends DisposableTrait {
	signal?: AbortSignal;
}

/**
 * Bridge foundation cancellation to `AbortSignal` without exposing
 * `AbortSignal` in core contracts.
 */
export function cancellationTokenToAbortSignal(
	token: CancellationTokenTrait,
): AbortSignalBridge;
export function cancellationTokenToAbortSignal(token?: undefined): undefined;
export function cancellationTokenToAbortSignal(
	token?: CancellationTokenTrait,
): AbortSignalBridge | undefined;
export function cancellationTokenToAbortSignal(
	token?: CancellationTokenTrait,
): AbortSignalBridge | undefined {
	if (!token) {
		return undefined;
	}

	const controller = new AbortController();
	let subscription: DisposableTrait | null = token.onCancellationRequested(
		(reason) => {
			controller.abort(reason);
		},
	);

	if (token.isCancellationRequested) {
		controller.abort(token.reason);
	}

	const dispose = () => {
		if (subscription) {
			subscription.dispose();
			subscription = null;
		}
	};

	return {
		signal: controller.signal,
		dispose,
		[SYMBOL_DISPOSE]: dispose,
	};
}

export function normalizeAbortError(
	token: CancellationTokenTrait | undefined,
	error: unknown,
): unknown {
	if (!isAbortError(error) && !token?.isCancellationRequested) {
		return error;
	}

	const reason = token?.reason;
	if (reason instanceof ClientError) {
		return reason;
	}

	if (reason instanceof Error) {
		return new ClientError({
			kind: ClientErrorKind.Cancelled,
			message: reason.message,
			code: "client.cancelled",
			source: ClientErrorSource.Transport,
			cause: reason,
		});
	}

	return new ClientError({
		kind: ClientErrorKind.Cancelled,
		message: "HTTP request was cancelled",
		code: "client.cancelled",
		source: ClientErrorSource.Transport,
		cause: reason ?? error,
	});
}

function isAbortError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"name" in error &&
		error.name === "AbortError"
	);
}
