import {
	catchError,
	defer,
	filter,
	firstValueFrom,
	fromEvent,
	map,
	mergeMap,
	NEVER,
	of,
	race,
	switchMap,
	take,
	tap,
	throwError,
	timeout,
	timer,
} from "rxjs";

export class BackendWaitTimeoutError extends Error {
	override readonly name = "BackendWaitTimeoutError";

	constructor(
		readonly url: string,
		readonly timeoutMs: number,
	) {
		super(`Backend not ready after ${timeoutMs}ms: ${url}`);
	}
}

export class BackendWaitCancelledError extends Error {
	override readonly name = "BackendWaitCancelledError";

	constructor(readonly url: string) {
		super(`Backend wait cancelled: ${url}`);
	}
}

export interface WaitForHttpOkOptions {
	url: string;
	timeoutMs?: number;
	intervalMs?: number;
	requestTimeoutMs?: number;
	signal?: AbortSignal;
	onAttempt?: (attempt: number) => void;
}

function createRequestSignal(
	signal: AbortSignal | undefined,
	requestTimeoutMs: number,
): AbortSignal {
	const requestSignal = AbortSignal.timeout(requestTimeoutMs);
	if (!signal) {
		return requestSignal;
	}

	return AbortSignal.any([signal, requestSignal]);
}

function abortSignalError(url: string, signal: AbortSignal | undefined) {
	if (!signal?.aborted) {
		return undefined;
	}

	return new BackendWaitCancelledError(url);
}

function fromAbortSignal(url: string, signal: AbortSignal | undefined) {
	if (!signal) {
		return NEVER;
	}

	return fromEvent(signal, "abort").pipe(
		mergeMap(() => throwError(() => new BackendWaitCancelledError(url))),
	);
}

function probeOnce(
	url: string,
	requestTimeoutMs: number,
	signal: AbortSignal | undefined,
) {
	return defer(async () => {
		const response = await fetch(url, {
			signal: createRequestSignal(signal, requestTimeoutMs),
		});
		return response.ok;
	}).pipe(catchError(() => of(false)));
}

export async function waitForHttpOk(
	options: WaitForHttpOkOptions,
): Promise<void> {
	const {
		url,
		timeoutMs = 120_000,
		intervalMs = 500,
		requestTimeoutMs = 5_000,
		signal,
		onAttempt,
	} = options;

	const cancelled = abortSignalError(url, signal);
	if (cancelled) {
		throw cancelled;
	}

	let attempt = 0;

	await firstValueFrom(
		race(
			timer(0, intervalMs).pipe(
				tap(() => {
					attempt += 1;
					onAttempt?.(attempt);
				}),
				switchMap(() => probeOnce(url, requestTimeoutMs, signal)),
				filter((ok): ok is true => ok),
				take(1),
				timeout({
					first: timeoutMs,
					with: () =>
						throwError(() => new BackendWaitTimeoutError(url, timeoutMs)),
				}),
				map(() => undefined),
			),
			fromAbortSignal(url, signal),
		),
	);
}
