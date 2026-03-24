import { createDefaultClock } from "../scheduling/default-clock";
import { createDefaultScheduler } from "../scheduling/default-scheduler";
import type { HttpTransport } from "../transport/types";
import type { ClientRuntime } from "./types";

export interface CreateRuntimeOptions
	extends Partial<Omit<ClientRuntime, "transport">> {
	transport: HttpTransport;
}

/**
 * Create a `ClientRuntime` with non-host-specific defaults filled in for
 * convenience.
 *
 * Host-specific capabilities such as browser `fetch` should be supplied
 * explicitly or composed via adapter-specific helpers such as
 * `@securitydept/client/web`.
 */
export function createRuntime(overrides: CreateRuntimeOptions): ClientRuntime {
	return {
		transport: overrides.transport,
		scheduler: overrides.scheduler ?? createDefaultScheduler(),
		clock: overrides.clock ?? createDefaultClock(),
		logger: overrides.logger,
		traceSink: overrides.traceSink,
		persistentStore: overrides.persistentStore,
		sessionStore: overrides.sessionStore,
	};
}
