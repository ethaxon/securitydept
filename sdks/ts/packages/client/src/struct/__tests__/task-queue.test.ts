import { describe, expect, it, vi } from "vitest";

import { OnDemandTaskQueue } from "../task-queue";

describe("OnDemandTaskQueue", () => {
	it("runs tasks serially in enqueue order", async () => {
		const observed: number[] = [];
		const queue = new OnDemandTaskQueue<number, number>({
			run: async ({ task }) => {
				observed.push(task);
				return task * 2;
			},
		});

		await expect(
			Promise.all([queue.enqueue(1), queue.enqueue(2), queue.enqueue(3)]),
		).resolves.toEqual([2, 4, 6]);
		expect(observed).toEqual([1, 2, 3]);
		expect(queue.pendingCount).toBe(0);
		expect(queue.isRunning).toBe(false);
	});

	it("continues draining tasks enqueued while a run is active", async () => {
		const observed: number[] = [];
		let releaseFirst: (() => void) | undefined;
		const firstBarrier = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const queue = new OnDemandTaskQueue<number>({
			run: async ({ task }) => {
				observed.push(task);
				if (task === 1) {
					await firstBarrier;
				}
			},
		});

		const first = queue.enqueue(1);
		const second = queue.enqueue(2);
		expect(queue.isRunning).toBe(true);
		expect(queue.pendingCount).toBe(1);

		releaseFirst?.();
		await expect(Promise.all([first, second])).resolves.toEqual([
			undefined,
			undefined,
		]);
		expect(observed).toEqual([1, 2]);
	});

	it("rejects only the failed task and keeps draining later tasks", async () => {
		const queue = new OnDemandTaskQueue<number, number>({
			run: ({ task }) => {
				if (task === 2) {
					throw new Error("boom");
				}
				return task;
			},
		});

		const first = queue.enqueue(1);
		const second = queue.enqueue(2);
		const third = queue.enqueue(3);

		await expect(first).resolves.toBe(1);
		await expect(second).rejects.toThrow("boom");
		await expect(third).resolves.toBe(3);
		expect(queue.pendingCount).toBe(0);
	});

	it("rejects queued tasks without affecting the active task", async () => {
		let releaseFirst: (() => void) | undefined;
		const firstBarrier = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const run = vi.fn(async ({ task }: { task: number }) => {
			if (task === 1) {
				await firstBarrier;
			}
			return task;
		});
		const queue = new OnDemandTaskQueue<number, number>({ run });

		const first = queue.enqueue(1);
		const second = queue.enqueue(2);
		const error = new Error("disposed");
		queue.rejectQueued(error);

		await expect(second).rejects.toBe(error);
		releaseFirst?.();
		await expect(first).resolves.toBe(1);
		expect(run).toHaveBeenCalledTimes(1);
	});
});
