import type { CancelableHandle, Scheduler } from "@securitydept/client";
import type { FakeClock } from "./fake-clock";

interface ScheduledTask {
	executeAt: number;
	fn: () => void;
	cancelled: boolean;
}

/**
 * Fake scheduler for deterministic async testing.
 * Pending tasks are only executed when `flush()` or `advanceAndFlush()` is called.
 */
export class FakeScheduler implements Scheduler {
	private readonly _tasks: ScheduledTask[] = [];

	constructor(private readonly _clock: FakeClock) {}

	setTimeout(delayMs: number, fn: () => void): CancelableHandle {
		const task: ScheduledTask = {
			executeAt: this._clock.now() + delayMs,
			fn,
			cancelled: false,
		};
		this._tasks.push(task);
		return {
			cancel() {
				task.cancelled = true;
			},
		};
	}

	/** Execute all tasks whose scheduled time has been reached. */
	flush(): void {
		const now = this._clock.now();
		// Execute tasks in scheduled order.
		const ready = this._tasks
			.filter((t) => !t.cancelled && t.executeAt <= now)
			.sort((a, b) => a.executeAt - b.executeAt);

		for (const task of ready) {
			const idx = this._tasks.indexOf(task);
			if (idx !== -1) this._tasks.splice(idx, 1);
			if (!task.cancelled) task.fn();
		}
	}

	/** Advance the clock and flush pending tasks. */
	advanceAndFlush(ms: number): void {
		this._clock.advance(ms);
		this.flush();
	}

	/** Number of pending (non-cancelled) tasks. */
	get pendingCount(): number {
		return this._tasks.filter((t) => !t.cancelled).length;
	}
}
