import { ClientError } from "../errors/client-error";
import { ClientErrorKind } from "../errors/types";
import type {
	CancellationTokenSourceTrait,
	CancellationTokenTrait,
	DisposableTrait,
} from "./types";

class CancellationToken implements CancellationTokenTrait {
	private _isCancelled = false;
	private _reason: unknown;
	private readonly _listeners = new Set<(reason: unknown) => void>();

	get isCancellationRequested(): boolean {
		return this._isCancelled;
	}

	get reason(): unknown {
		return this._reason;
	}

	/** @internal — called by `CancellationTokenSource`. */
	_cancel(reason: unknown): void {
		if (this._isCancelled) return;
		this._isCancelled = true;
		this._reason = reason;
		for (const listener of this._listeners) {
			listener(reason);
		}
		this._listeners.clear();
	}

	onCancellationRequested(
		listener: (reason: unknown) => void,
	): DisposableTrait {
		if (this._isCancelled) {
			// Already cancelled — invoke immediately.
			listener(this._reason);
			return { dispose() {} };
		}
		this._listeners.add(listener);
		return {
			dispose: () => {
				this._listeners.delete(listener);
			},
		};
	}

	throwIfCancellationRequested(): void {
		if (this._isCancelled) {
			throw new ClientError({
				kind: ClientErrorKind.Cancelled,
				message: "Operation was cancelled",
				cause: this._reason,
			});
		}
	}
}

/**
 * Create a `CancellationTokenSource` that produces a cooperative cancellation token.
 */
export function createCancellationTokenSource(): CancellationTokenSourceTrait {
	const ct = new CancellationToken();
	let disposed = false;

	return {
		get token(): CancellationTokenTrait {
			return ct;
		},
		cancel(reason?: unknown) {
			if (!disposed) ct._cancel(reason);
		},
		dispose() {
			if (!disposed) {
				disposed = true;
				ct._cancel(
					new ClientError({
						kind: ClientErrorKind.Cancelled,
						message: "Disposed",
					}),
				);
			}
		},
	};
}
