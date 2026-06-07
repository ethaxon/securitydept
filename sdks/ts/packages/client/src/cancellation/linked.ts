import { merge, ReplaySubject, take, takeUntil } from "rxjs";
import {
	type DisposableTrait,
	type SubscribableTrait,
	SYMBOL_DISPOSE,
	SYMBOL_OBSERVABLE,
} from "../compat";
import { type ClientError } from "../errors";
import { CancellationToken } from "./create";
import {
	type CancellationTokenErrorData,
	type CancellationTokenTrait,
} from "./types";

export class LinkedCancellationToken
	implements CancellationTokenTrait, DisposableTrait
{
	destoryed$ = new ReplaySubject<boolean>(1);
	protected readonly token: CancellationTokenTrait;

	constructor(protected readonly sources: CancellationTokenTrait[]) {
		if (sources.length === 0) {
			this.token = new CancellationToken();
		}

		// One source — return directly; no allocation needed.
		if (sources.length === 1) {
			this.token = sources[0];
		}

		// Fast-path: return the first already-cancelled source immediately.
		for (const source of sources) {
			if (source.isCancellationRequested) {
				this.token = source;
				return;
			}
		}

		const newToken = new CancellationToken();

		merge(...sources)
			.pipe(take(1), takeUntil(this.destoryed$))
			.subscribe(({ reason }) => {
				newToken._cancel(reason);
			});

		this.token = newToken;
	}
	get isCancellationRequested(): boolean {
		return this.token.isCancellationRequested;
	}
	get cancellationError(): ClientError | undefined {
		return this.token.cancellationError;
	}
	get reason(): unknown {
		return this.token.reason;
	}
	onCancellationRequested(
		listener: (data: CancellationTokenErrorData) => void,
	): DisposableTrait {
		return this.token.onCancellationRequested(listener);
	}
	throwIfCancellationRequested(): void {
		this.token.throwIfCancellationRequested();
	}

	dispose() {
		this.destoryed$.next(true);
	}

	[SYMBOL_DISPOSE]() {
		this.dispose();
	}

	[SYMBOL_OBSERVABLE](): SubscribableTrait<CancellationTokenErrorData> {
		return this.token[SYMBOL_OBSERVABLE]();
	}
}

/**
 * Create a cancellation token that fires when ANY of the given source tokens
 * is cancelled.
 *
 * - Zero sources → returns a token that is never cancelled.
 * - One source   → returns that source directly (no allocation).
 * - N sources    → creates a linked source, subscribes to all, and cleans up
 *   subscriptions once the linked token fires.
 *
 * @example
 * const cts = createCancellationTokenSource();
 * const linked = createLinkedCancellationToken(clientRoot.token, cts.token);
 * await transport.execute({ ..., cancellationToken: linked });
 */
export function createLinkedCancellationToken(
	...sources: readonly (CancellationTokenTrait | undefined | null)[]
): CancellationTokenTrait & DisposableTrait {
	return new LinkedCancellationToken(
		sources.filter((s): s is CancellationTokenTrait => !!s),
	);
}
