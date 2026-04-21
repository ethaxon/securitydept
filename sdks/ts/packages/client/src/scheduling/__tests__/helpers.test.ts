// Scheduling helpers — focused unit tests
//
// Tests for timer, interval, scheduleAt, fromSignal, fromPromise, fromEventPattern.

import { describe, expect, it, vi } from "vitest";
import { createSignal } from "../../signals/signal";
import {
	fromEventPattern,
	fromPromise,
	fromSignal,
	interval,
	PromiseSettlementKind,
	scheduleAt,
	timer,
} from "../helpers";
import type { Clock, Scheduler } from "../types";

// ---------------------------------------------------------------------------
// Test scheduler: deterministic, synchronous flush
// ---------------------------------------------------------------------------

interface ScheduledTask {
	delayMs: number;
	fn: () => void;
	canceled: boolean;
}

function createTestScheduler(): Scheduler & {
	tasks: ScheduledTask[];
	flush: () => void;
	flushNext: () => void;
} {
	const tasks: ScheduledTask[] = [];
	return {
		tasks,
		setTimeout(delayMs: number, fn: () => void) {
			const task: ScheduledTask = { delayMs, fn, canceled: false };
			tasks.push(task);
			return {
				cancel() {
					task.canceled = true;
				},
			};
		},
		flush() {
			while (tasks.length > 0) {
				const task = tasks.shift()!;
				if (!task.canceled) task.fn();
			}
		},
		flushNext() {
			const task = tasks.shift();
			if (task && !task.canceled) task.fn();
		},
	};
}

function createTestClock(
	initialMs = 1000,
): Clock & { advance: (ms: number) => void } {
	let now = initialMs;
	return {
		now: () => now,
		advance(ms: number) {
			now += ms;
		},
	};
}

// ---------------------------------------------------------------------------
// timer
// ---------------------------------------------------------------------------

describe("timer", () => {
	it("fires callback after delay", () => {
		const scheduler = createTestScheduler();
		const callback = vi.fn();

		timer({ scheduler, delayMs: 5000, callback });

		expect(callback).not.toHaveBeenCalled();
		scheduler.flush();
		expect(callback).toHaveBeenCalledOnce();
	});

	it("can be canceled before firing", () => {
		const scheduler = createTestScheduler();
		const callback = vi.fn();

		const handle = timer({ scheduler, delayMs: 5000, callback });
		handle.cancel();
		scheduler.flush();

		expect(callback).not.toHaveBeenCalled();
	});

	it("passes correct delay to scheduler", () => {
		const scheduler = createTestScheduler();
		timer({ scheduler, delayMs: 3000, callback: vi.fn() });

		expect(scheduler.tasks).toHaveLength(1);
		expect(scheduler.tasks[0].delayMs).toBe(3000);
	});
});

// ---------------------------------------------------------------------------
// interval
// ---------------------------------------------------------------------------

describe("interval", () => {
	it("fires callback repeatedly", () => {
		const scheduler = createTestScheduler();
		const callback = vi.fn();

		interval({ scheduler, periodMs: 1000, callback });

		// First tick.
		scheduler.flushNext();
		expect(callback).toHaveBeenCalledTimes(1);

		// Second tick (re-scheduled by first).
		scheduler.flushNext();
		expect(callback).toHaveBeenCalledTimes(2);

		// Third tick.
		scheduler.flushNext();
		expect(callback).toHaveBeenCalledTimes(3);
	});

	it("stops when canceled", () => {
		const scheduler = createTestScheduler();
		const callback = vi.fn();

		const handle = interval({ scheduler, periodMs: 1000, callback });

		scheduler.flushNext();
		expect(callback).toHaveBeenCalledTimes(1);

		handle.cancel();

		// No more ticks should fire.
		scheduler.flush();
		expect(callback).toHaveBeenCalledTimes(1);
	});

	it("uses correct period", () => {
		const scheduler = createTestScheduler();
		interval({ scheduler, periodMs: 5000, callback: vi.fn() });

		expect(scheduler.tasks[0].delayMs).toBe(5000);
	});
});

// ---------------------------------------------------------------------------
// scheduleAt
// ---------------------------------------------------------------------------

describe("scheduleAt", () => {
	it("schedules callback at future time", () => {
		const scheduler = createTestScheduler();
		const clock = createTestClock(10000);
		const callback = vi.fn();

		scheduleAt({
			scheduler,
			clock,
			atMs: 15000,
			callback,
		});

		expect(scheduler.tasks[0].delayMs).toBe(5000);

		scheduler.flush();
		expect(callback).toHaveBeenCalledOnce();
	});

	it("fires immediately (delay 0) when target is in the past", () => {
		const scheduler = createTestScheduler();
		const clock = createTestClock(20000);
		const callback = vi.fn();

		scheduleAt({
			scheduler,
			clock,
			atMs: 15000,
			callback,
		});

		// Delay should be 0 (clamped by Math.max).
		expect(scheduler.tasks[0].delayMs).toBe(0);

		scheduler.flush();
		expect(callback).toHaveBeenCalledOnce();
	});

	it("can be canceled", () => {
		const scheduler = createTestScheduler();
		const clock = createTestClock(10000);
		const callback = vi.fn();

		const handle = scheduleAt({
			scheduler,
			clock,
			atMs: 15000,
			callback,
		});

		handle.cancel();
		scheduler.flush();
		expect(callback).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// fromSignal
// ---------------------------------------------------------------------------

describe("fromSignal", () => {
	it("delivers updated signal snapshots", () => {
		const signal = createSignal("idle");
		const callback = vi.fn();

		const subscription = fromSignal({ signal, callback });
		signal.set("ready");
		signal.set("done");

		expect(callback).toHaveBeenCalledTimes(2);
		expect(callback).toHaveBeenNthCalledWith(1, "ready");
		expect(callback).toHaveBeenNthCalledWith(2, "done");

		subscription.unsubscribe();
	});

	it("can emit the current snapshot immediately", () => {
		const signal = createSignal("bootstrapped");
		const callback = vi.fn();

		fromSignal({
			signal,
			callback,
			emitInitialValue: true,
		});

		expect(callback).toHaveBeenCalledOnce();
		expect(callback).toHaveBeenCalledWith("bootstrapped");
	});

	it("stops delivering updates after unsubscribe", () => {
		const signal = createSignal("idle");
		const callback = vi.fn();

		const subscription = fromSignal({ signal, callback });
		subscription.unsubscribe();
		signal.set("ignored");

		expect(callback).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// fromPromise
// ---------------------------------------------------------------------------

describe("fromPromise", () => {
	it("reports fulfilled settlement", async () => {
		const callback = vi.fn();

		fromPromise({
			promise: Promise.resolve("ready"),
			callback,
		});

		await Promise.resolve();

		expect(callback).toHaveBeenCalledWith({
			kind: PromiseSettlementKind.Fulfilled,
			value: "ready",
		});
	});

	it("reports rejected settlement", async () => {
		const callback = vi.fn();

		fromPromise({
			promise: Promise.reject(new Error("boom")),
			callback,
		});

		await Promise.resolve();

		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback.mock.calls[0][0]).toMatchObject({
			kind: PromiseSettlementKind.Rejected,
			reason: expect.objectContaining({
				message: "boom",
			}),
		});
	});

	it("ignores settlement after unsubscribe", async () => {
		let resolvePromise: ((value: string) => void) | undefined;
		const callback = vi.fn();
		const promise = new Promise<string>((resolve) => {
			resolvePromise = resolve;
		});

		const subscription = fromPromise({
			promise,
			callback,
		});
		subscription.unsubscribe();
		resolvePromise?.("ignored");
		await Promise.resolve();

		expect(callback).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// fromEventPattern
// ---------------------------------------------------------------------------

describe("fromEventPattern", () => {
	it("installs handler and delivers events", () => {
		const handlers: Array<(value: string) => void> = [];
		const callback = vi.fn();

		fromEventPattern<string>({
			addHandler: (h) => handlers.push(h),
			removeHandler: (h) => {
				const idx = handlers.indexOf(h);
				if (idx >= 0) handlers.splice(idx, 1);
			},
			callback,
		});

		expect(handlers).toHaveLength(1);

		// Simulate event.
		handlers[0]("event-1");
		expect(callback).toHaveBeenCalledWith("event-1");

		handlers[0]("event-2");
		expect(callback).toHaveBeenCalledWith("event-2");
		expect(callback).toHaveBeenCalledTimes(2);
	});

	it("removes handler on unsubscribe", () => {
		const handlers: Array<(value: number) => void> = [];
		const callback = vi.fn();

		const sub = fromEventPattern<number>({
			addHandler: (h) => handlers.push(h),
			removeHandler: (h) => {
				const idx = handlers.indexOf(h);
				if (idx >= 0) handlers.splice(idx, 1);
			},
			callback,
		});

		expect(handlers).toHaveLength(1);
		sub.unsubscribe();
		expect(handlers).toHaveLength(0);
	});
});
