import { AsyncAction } from "rxjs/internal/scheduler/AsyncAction";
import { AsyncScheduler } from "rxjs/internal/scheduler/AsyncScheduler";
import type { TimestampProviderTrait } from "../scheduling";

export function createAsyncSchedulerWithTimestampProvider(
	time: TimestampProviderTrait,
): AsyncScheduler {
	return new AsyncScheduler(AsyncAction, time.now);
}
