import { Queue } from "mnemonist";

export interface OnDemandTaskQueueTaskEnvelope<TTask> {
	readonly id: number;
	readonly task: TTask;
	readonly enqueuedAt: number;
}

interface OnDemandTaskQueueInternalTaskEnvelope<TTask, TResult>
	extends OnDemandTaskQueueTaskEnvelope<TTask> {
	readonly resolve: (result: TResult) => void;
	readonly reject: (error: unknown) => void;
}

export interface OnDemandTaskQueueOptions<TTask, TResult> {
	readonly now?: () => number;
	readonly run: (
		task: OnDemandTaskQueueTaskEnvelope<TTask>,
	) => Promise<TResult> | TResult;
}

export class OnDemandTaskQueue<TTask, TResult = void> {
	private readonly _queue = new Queue<
		OnDemandTaskQueueInternalTaskEnvelope<TTask, TResult>
	>();
	private readonly _now: () => number;
	private readonly _run: (
		task: OnDemandTaskQueueTaskEnvelope<TTask>,
	) => Promise<TResult> | TResult;
	private _running = false;
	private _taskSequence = 0;

	constructor(options: OnDemandTaskQueueOptions<TTask, TResult>) {
		this._now = options.now ?? Date.now;
		this._run = options.run;
	}

	get isRunning(): boolean {
		return this._running;
	}

	get pendingCount(): number {
		return this._queue.size;
	}

	enqueue(task: TTask): Promise<TResult> {
		return new Promise<TResult>((resolve, reject) => {
			this._queue.enqueue({
				id: ++this._taskSequence,
				task,
				enqueuedAt: this._now(),
				resolve,
				reject,
			});
			this._drain();
		});
	}

	rejectQueued(error: unknown): void {
		while (this._queue.size > 0) {
			this._queue.dequeue()?.reject(error);
		}
	}

	private _drain(): void {
		if (this._running) {
			return;
		}
		this._running = true;
		void this._runLoop();
	}

	private async _runLoop(): Promise<void> {
		try {
			while (this._queue.size > 0) {
				const task = this._queue.dequeue();
				if (!task) {
					continue;
				}
				try {
					task.resolve(await this._run(task));
				} catch (error) {
					task.reject(error);
				}
			}
		} finally {
			this._running = false;
		}
	}
}
