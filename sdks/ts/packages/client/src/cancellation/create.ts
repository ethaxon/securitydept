import { filter, map, type Observable, take } from "rxjs";
import { BehaviorSubject } from "rxjs/internal/BehaviorSubject";
import {
	type DisposableTrait,
	isInteropObservableTrait,
	SYMBOL_DISPOSE,
	SYMBOL_OBSERVABLE,
} from "../compat";
import { ClientError } from "../errors/client-error";
import { ClientErrorKind, ClientErrorSource } from "../errors/types";
import {
	type CancellationTokenErrorData,
	type CancellationTokenSourceTrait,
	type CancellationTokenTrait,
} from "./types";

interface CancellationTokenCancelledState extends CancellationTokenErrorData {
	readonly isCancelled: true;
}

type CancellationTokenUncancelledState = undefined;

type CancellationTokenState =
	| CancellationTokenCancelledState
	| CancellationTokenUncancelledState;

export class CancellationToken implements CancellationTokenTrait {
	private cancellationState = new BehaviorSubject<CancellationTokenState>(
		undefined,
	);

	get isCancellationRequested(): boolean {
		return this.cancellationState.getValue()?.isCancelled === true;
	}

	get reason(): unknown {
		return this.cancellationState.getValue()?.reason;
	}

	/** @internal — called by `CancellationTokenSource`. */
	_cancel(reason: unknown): void {
		if (this.isCancellationRequested) {
			return;
		}
		this.cancellationState.next({
			isCancelled: true,
			reason,
			cancellationError: new ClientError({
				kind: ClientErrorKind.Cancelled,
				message: "Operation was cancelled",
				code: "client.cancelled",
				source: ClientErrorSource.Client,
				cause: reason,
			}),
		});
	}

	onCancellationRequested(
		listener: (errorData: CancellationTokenErrorData) => void,
	): DisposableTrait {
		const cancellationState = this.cancellationState.getValue();
		if (cancellationState?.isCancelled) {
			listener({
				cancellationError: cancellationState.cancellationError,
				reason: cancellationState.reason,
			});
			return {
				dispose() {},
				[SYMBOL_DISPOSE]() {},
			};
		}

		const subscription = this.asObservable().subscribe((errorData) => {
			listener(errorData);
		});

		return {
			dispose() {
				subscription.unsubscribe();
			},
			[SYMBOL_DISPOSE]: () => {
				subscription.unsubscribe();
			},
		};
	}

	throwIfCancellationRequested(): void {
		const cancellationState = this.cancellationState.getValue();
		if (cancellationState?.cancellationError) {
			throw cancellationState.cancellationError;
		}
	}

	get cancellationError(): ClientError | undefined {
		const cancellationState = this.cancellationState.getValue();
		return cancellationState?.cancellationError;
	}

	protected asObservable(): Observable<CancellationTokenErrorData> {
		return this.cancellationState.pipe(
			filter(
				(state): state is CancellationTokenCancelledState =>
					!!state?.isCancelled,
			),
			take(1),
			map((state) => ({
				cancellationError: state.cancellationError,
				reason: state.reason,
			})),
		);
	}

	[SYMBOL_OBSERVABLE]() {
		return this.asObservable();
	}
}

export class CancellationTokenSource implements CancellationTokenSourceTrait {
	readonly token = new CancellationToken();

	cancel(reason?: unknown) {
		this.token._cancel(reason);
	}
}

/**
 * Create a `CancellationTokenSource` that produces a cooperative cancellation token.
 */
export function createCancellationTokenSource(): CancellationTokenSourceTrait {
	return new CancellationTokenSource();
}

export function isCancellationTokenTrait(
	obj: unknown,
): obj is CancellationTokenTrait {
	return (
		typeof obj === "object" &&
		obj !== null &&
		typeof (obj as CancellationTokenTrait).isCancellationRequested ===
			"boolean" &&
		typeof (obj as CancellationTokenTrait).onCancellationRequested ===
			"function" &&
		typeof (obj as CancellationTokenTrait).throwIfCancellationRequested ===
			"function" &&
		isInteropObservableTrait(obj)
	);
}
