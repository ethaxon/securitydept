// TimeTrait and event-source focused unit tests.

import { describe, expect, it, vi } from "vitest";
import {
	fromEventPattern,
	fromInterval,
	fromPromise,
	fromScheduleAt,
	fromSignal,
	fromTimeout,
	PromiseSettlementKind,
} from "../../events";
import { createSignal } from "../../signals/signal";
import { createDefaultTimeConfig, parseDurationToMs } from "../index";
import type { TimeTrait } from "../types";

interface ScheduledTask {
	delayMs: number;
	fn: () => void;
	canceled: boolean;
}

function createTestTime(initialMs = 1000): TimeTrait & {
	tasks: ScheduledTask[];
	advance: (ms: number) => void;
	flush: () => void;
	flushNext: () => void;
} {
	let now = initialMs;
	const tasks: ScheduledTask[] = [];
	return {
		tasks,
		now: () => now,
		advance(ms: number) {
			now += ms;
		},
		setTimeout(fn: () => void, delayMs: number) {
			const task: ScheduledTask = { delayMs, fn, canceled: false };
			tasks.push(task);
			return task;
		},
		clearTimeout(handle: unknown) {
			if (isScheduledTask(handle)) {
				handle.canceled = true;
			}
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

function isScheduledTask(value: unknown): value is ScheduledTask {
	return (
		typeof value === "object" &&
		value !== null &&
		"delayMs" in value &&
		"fn" in value &&
		"canceled" in value
	);
}

describe("createDefaultTimeConfig", () => {
	it("exposes wall-clock and timer capabilities", () => {
		const time = createDefaultTimeConfig();

		expect(time.now()).toBeTypeOf("number");
		expect(typeof time.setTimeout).toBe("function");
		expect(typeof time.clearTimeout).toBe("function");
	});
});

describe("fromTimeout", () => {
	it("fires once and completes after delay", () => {
		const time = createTestTime();
		const next = vi.fn();
		const complete = vi.fn();

		fromTimeout({ time, delayMs: 5000 }).subscribe({ next, complete });

		expect(next).not.toHaveBeenCalled();
		expect(time.tasks[0].delayMs).toBe(5000);
		time.flush();
		expect(next).toHaveBeenCalledOnce();
		expect(complete).toHaveBeenCalledOnce();
	});

	it("can be unsubscribed before firing", () => {
		const time = createTestTime();
		const next = vi.fn();

		const subscription = fromTimeout({ time, delayMs: 5000 }).subscribe({
			next,
		});
		subscription.unsubscribe();
		time.flush();

		expect(next).not.toHaveBeenCalled();
	});
});

describe("fromInterval", () => {
	it("fires repeatedly until unsubscribed", () => {
		const time = createTestTime();
		const next = vi.fn();

		const subscription = fromInterval({ time, periodMs: 1000 }).subscribe({
			next,
		});

		time.flushNext();
		expect(next).toHaveBeenCalledTimes(1);
		time.flushNext();
		expect(next).toHaveBeenCalledTimes(2);

		subscription.unsubscribe();
		time.flush();
		expect(next).toHaveBeenCalledTimes(2);
	});
});

describe("fromScheduleAt", () => {
	it("schedules at future epoch time", () => {
		const time = createTestTime(10_000);
		const next = vi.fn();

		fromScheduleAt({ time, atMs: 15_000 }).subscribe({ next });

		expect(time.tasks[0].delayMs).toBe(5000);
		time.flush();
		expect(next).toHaveBeenCalledOnce();
	});

	it("uses zero delay for past epoch time", () => {
		const time = createTestTime(20_000);
		const next = vi.fn();

		fromScheduleAt({ time, atMs: 15_000 }).subscribe({ next });

		expect(time.tasks[0].delayMs).toBe(0);
		time.flush();
		expect(next).toHaveBeenCalledOnce();
	});
});

describe("parseDurationToMs", () => {
	it("parses supported duration suffixes into milliseconds", () => {
		expect(parseDurationToMs("150ms")).toBe(150);
		expect(parseDurationToMs("2s")).toBe(2000);
		expect(parseDurationToMs("1.5m")).toBe(90_000);
		expect(parseDurationToMs("1h")).toBe(3_600_000);
	});

	it("returns zero for unsupported duration strings", () => {
		expect(parseDurationToMs("10d")).toBe(0);
		expect(parseDurationToMs("never")).toBe(0);
	});
});

describe("fromSignal", () => {
	it("delivers updated signal snapshots", () => {
		const signal = createSignal("idle");
		const next = vi.fn();

		const subscription = fromSignal({ signal }).subscribe({ next });
		signal.set("ready");
		signal.set("done");

		expect(next).toHaveBeenNthCalledWith(1, "ready");
		expect(next).toHaveBeenNthCalledWith(2, "done");

		subscription.unsubscribe();
	});

	it("can emit the current snapshot immediately", () => {
		const signal = createSignal("bootstrapped");
		const next = vi.fn();

		fromSignal({ signal, emitInitialValue: true }).subscribe({ next });

		expect(next).toHaveBeenCalledWith("bootstrapped");
	});
});

describe("fromPromise", () => {
	it("reports fulfilled settlement", async () => {
		const next = vi.fn();

		fromPromise({ promise: Promise.resolve("ready") }).subscribe({ next });

		await Promise.resolve();

		expect(next).toHaveBeenCalledWith({
			kind: PromiseSettlementKind.Fulfilled,
			value: "ready",
		});
	});

	it("reports rejected settlement", async () => {
		const next = vi.fn();

		fromPromise({ promise: Promise.reject(new Error("boom")) }).subscribe({
			next,
		});

		await Promise.resolve();

		expect(next.mock.calls[0][0]).toMatchObject({
			kind: PromiseSettlementKind.Rejected,
			reason: expect.objectContaining({
				message: "boom",
			}),
		});
	});

	it("ignores settlement after unsubscribe", async () => {
		let resolvePromise: ((value: string) => void) | undefined;
		const next = vi.fn();
		const promise = new Promise<string>((resolve) => {
			resolvePromise = resolve;
		});

		const subscription = fromPromise({ promise }).subscribe({ next });
		subscription.unsubscribe();
		resolvePromise?.("ignored");
		await Promise.resolve();

		expect(next).not.toHaveBeenCalled();
	});
});

describe("fromEventPattern", () => {
	it("installs handler and delivers events", () => {
		const handlers: Array<(value: string) => void> = [];
		const next = vi.fn();

		fromEventPattern<string>({
			addHandler: (handler) => handlers.push(handler),
			removeHandler: (handler) => {
				const index = handlers.indexOf(handler);
				if (index >= 0) handlers.splice(index, 1);
			},
		}).subscribe({ next });

		handlers[0]("event-1");
		handlers[0]("event-2");

		expect(next).toHaveBeenNthCalledWith(1, "event-1");
		expect(next).toHaveBeenNthCalledWith(2, "event-2");
	});

	it("removes handler on unsubscribe", () => {
		const handlers: Array<(value: number) => void> = [];

		const subscription = fromEventPattern<number>({
			addHandler: (handler) => handlers.push(handler),
			removeHandler: (handler) => {
				const index = handlers.indexOf(handler);
				if (index >= 0) handlers.splice(index, 1);
			},
		}).subscribe({});

		expect(handlers).toHaveLength(1);
		subscription.unsubscribe();
		expect(handlers).toHaveLength(0);
	});
});
