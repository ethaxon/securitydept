import { type as defineType } from "arktype";
import { type EnvironmentValidators } from "../environment/types";
import { type TimeTrait } from "../scheduling/types";
import {
	throwValidationClientError,
	validateTraitInput,
	type WithTraitInputValidator,
} from "../validation";

export interface TestTimeTrait extends TimeTrait {
	advance(ms: number): void;
	flush(): void;
	advanceAndFlush(ms: number): void;
	get pendingCount(): number;
}

export interface TimeForTestCreateOptions {
	initialNow?: number;
}

const TimeForTestCreateOptionsSchema = defineType({
	initialNow: "number",
});

export function createTimeForTest(
	options: TimeForTestCreateOptions &
		WithTraitInputValidator<Pick<EnvironmentValidators, "time">> = {},
): TestTimeTrait {
	const { validators, ...createOptions } = options;
	const resolvedCreateOptions = {
		initialNow: createOptions.initialNow ?? 0,
	};
	validateTraitInput({
		value: resolvedCreateOptions,
		bundledSchema: TimeForTestCreateOptionsSchema,
		validator: validators?.time,
		onInvalid: (failure) =>
			throwValidationClientError({
				code: "test.time.invalid_options",
				source: "test",
				messagePrefix: "createTimeForTest could not validate time",
				failure,
			}),
	});
	let now = resolvedCreateOptions.initialNow;
	let nextId = 1;
	const tasks = new Map<number, { at: number; handler: () => void }>();
	return {
		now: () => now,
		setTimeout(handler, delayMs) {
			const id = nextId++;
			tasks.set(id, { at: now + Math.max(0, delayMs), handler });
			return id;
		},
		clearTimeout(handle) {
			if (typeof handle === "number") {
				tasks.delete(handle);
			}
		},
		advance(ms) {
			now += ms;
		},
		flush() {
			let progressed = true;
			while (progressed) {
				progressed = false;
				const ready = [...tasks.entries()]
					.filter(([, task]) => task.at <= now)
					.sort((a, b) => a[1].at - b[1].at);
				for (const [id, task] of ready) {
					tasks.delete(id);
					task.handler();
					progressed = true;
				}
			}
		},
		advanceAndFlush(ms) {
			this.advance(ms);
			this.flush();
		},
		get pendingCount() {
			return tasks.size;
		},
	};
}
