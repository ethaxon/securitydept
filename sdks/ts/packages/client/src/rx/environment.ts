import { AsyncAction } from "rxjs/internal/scheduler/AsyncAction";
import { AsyncScheduler } from "rxjs/internal/scheduler/AsyncScheduler";
import { type TimerHandle } from "rxjs/internal/scheduler/timerHandle";
import { type TimeTrait } from "../scheduling";

export function createAsyncSchedulerWithTimestampProvider(
	time: TimeTrait,
): AsyncScheduler {
	class TimeTraitAsyncAction<T> extends AsyncAction<T> {
		protected override requestAsyncId(
			scheduler: AsyncScheduler,
			_id?: TimerHandle,
			delay = 0,
		): TimerHandle {
			return time.setTimeout(() => {
				scheduler.flush(this);
			}, delay) as TimerHandle;
		}

		protected override recycleAsyncId(
			_scheduler: AsyncScheduler,
			id?: TimerHandle,
			delay: number | null = 0,
		): TimerHandle | undefined {
			if (delay != null && this.delay === delay && this.pending === false) {
				return id;
			}

			if (id !== undefined) {
				time.clearTimeout(id);
			}

			return undefined;
		}
	}

	return new AsyncScheduler(TimeTraitAsyncAction, time.now);
}
