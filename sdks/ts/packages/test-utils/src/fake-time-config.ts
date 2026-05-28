import { type TimeTrait } from "@securitydept/client";
import { FakeClock } from "./fake-clock";

interface ScheduledTask {
	executeAt: number;
	fn: () => void;
	cancelled: boolean;
}

/**
 * Fake TimeTrait for deterministic async testing.
 * Pending tasks execute only when `flush()` or `advanceAndFlush()` is called.
 */
export class FakeTimeConfig extends FakeClock implements TimeTrait {
	private readonly _tasks: ScheduledTask[] = [];

	setTimeout(fn: () => void, delayMs: number): ScheduledTask {
		const task: ScheduledTask = {
			executeAt: this.now() + delayMs,
			fn,
			cancelled: false,
		};
		this._tasks.push(task);
		return task;
	}

	clearTimeout(handle: unknown): void {
		if (isScheduledTask(handle)) {
			handle.cancelled = true;
		}
	}

	/** Execute all tasks whose scheduled time has been reached. */
	flush(): void {
		const now = this.now();
		const ready = this._tasks
			.filter((task) => !task.cancelled && task.executeAt <= now)
			.sort((a, b) => a.executeAt - b.executeAt);

		for (const task of ready) {
			const index = this._tasks.indexOf(task);
			if (index !== -1) {
				this._tasks.splice(index, 1);
			}
			if (!task.cancelled) {
				task.fn();
			}
		}
	}

	/** Advance the clock and flush pending tasks. */
	advanceAndFlush(ms: number): void {
		this.advance(ms);
		this.flush();
	}

	/** Number of pending non-cancelled tasks. */
	get pendingCount(): number {
		return this._tasks.filter((task) => !task.cancelled).length;
	}
}

function isScheduledTask(value: unknown): value is ScheduledTask {
	return (
		typeof value === "object" &&
		value !== null &&
		"executeAt" in value &&
		"fn" in value &&
		"cancelled" in value
	);
}
