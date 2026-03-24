import type { Clock } from "@securitydept/client";

/**
 * Fake clock for deterministic time control in tests.
 * Time starts at the provided initial value and only advances via `advance()`.
 */
export class FakeClock implements Clock {
	private _now: number;

	constructor(initial = 0) {
		this._now = initial;
	}

	now(): number {
		return this._now;
	}

	/** Advance the clock by the given number of milliseconds. */
	advance(ms: number): void {
		this._now += ms;
	}

	/** Set the clock to an absolute time. */
	setTime(ms: number): void {
		this._now = ms;
	}
}
