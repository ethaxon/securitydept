import type {
	CancellationTokenTrait,
	DisposableTrait,
} from "../cancellation/types";
import { ClientError } from "../errors/client-error";
import { ClientErrorKind, ClientErrorSource } from "../errors/types";
import { fromAbortSignal } from "./input-sources";

export interface AbortSignalBridge {
	signal?: AbortSignal;
	dispose(): void;
}

/**
 * Bridge a web `AbortSignal` back into the foundation cancellation contract.
 *
 * This is the canonical consumer-side path for browser hosts that receive an
 * `AbortSignal` from framework/runtime APIs (for example React Query queryFns)
 * but need to call SDK surfaces that accept `CancellationTokenTrait`.
 */
export function createCancellationTokenFromAbortSignal(
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
			const subscription = fromAbortSignal({
				signal,
				callback: listener,
				emitIfAborted: true,
			});
			return {
				dispose() {
					subscription.unsubscribe();
				},
			};
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
	};
}

/**
 * Bridge foundation cancellation to web `AbortSignal` without exposing
 * `AbortSignal` in core contracts.
 */
export function createAbortSignalBridge(
	token?: CancellationTokenTrait,
): AbortSignalBridge {
	if (!token) {
		return {
			signal: undefined,
			dispose() {},
		};
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

	return {
		signal: controller.signal,
		dispose() {
			subscription?.dispose();
			subscription = null;
		},
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
