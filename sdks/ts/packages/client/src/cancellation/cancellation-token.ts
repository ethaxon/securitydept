import { filter, map, type Observable, take } from "rxjs";
import { BehaviorSubject } from "rxjs/internal/BehaviorSubject";
import {
	type DisposableTrait,
	type InteropObservableTrait,
	isInteropObservableTrait,
	SYMBOL_DISPOSE,
	SYMBOL_OBSERVABLE,
} from "../compat";
import { ClientError } from "../errors/client-error";
import { ClientErrorKind } from "../errors/types";
import {
	type CancellationTokenSourceTrait,
	type CancellationTokenTrait,
} from "./types";

class CancellationToken
	implements CancellationTokenTrait, InteropObservableTrait<unknown>
{
	private _isCancelled = new BehaviorSubject(false);
	private _reason: unknown;

	get isCancellationRequested(): boolean {
		return this._isCancelled.getValue();
	}

	get reason(): unknown {
		return this._reason;
	}

	/** @internal — called by `CancellationTokenSource`. */
	_cancel(reason: unknown): void {
		const isCancelled = this._isCancelled.getValue();
		if (isCancelled) return;
		this._reason = reason;
		this._isCancelled.next(true);
		this._isCancelled.complete();
	}

	onCancellationRequested(
		listener: (reason: unknown) => void,
	): DisposableTrait {
		const subscription = this._asObservable().subscribe(() => {
			listener(this._reason);
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
		if (this._isCancelled.getValue()) {
			throw new ClientError({
				kind: ClientErrorKind.Cancelled,
				message: "Operation was cancelled",
				cause: this._reason,
			});
		}
	}

	private _asObservable(): Observable<unknown> {
		return this._isCancelled.pipe(
			filter((isCancelled) => !!isCancelled),
			take(1),
			map(() => this._reason),
		);
	}

	[SYMBOL_OBSERVABLE]() {
		return this._asObservable();
	}
}

/**
 * Create a `CancellationTokenSource` that produces a cooperative cancellation token.
 */
export function createCancellationTokenSource(): CancellationTokenSourceTrait {
	const ct = new CancellationToken();
	let disposed = false;

	const dispose = () => {
		if (!disposed) {
			disposed = true;
			ct._cancel(
				new ClientError({
					kind: ClientErrorKind.Cancelled,
					message: "Disposed",
				}),
			);
		}
	};

	return {
		get token(): CancellationTokenTrait {
			return ct;
		},
		cancel(reason?: unknown) {
			if (!disposed) ct._cancel(reason);
		},
		dispose,
		[SYMBOL_DISPOSE]() {
			dispose();
		},
	};
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
