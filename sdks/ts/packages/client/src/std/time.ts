import { type as defineType } from "arktype";
import { type TimeTrait } from "../scheduling/types";
import {
	type TraitInputValidator,
	throwValidationClientError,
	validateTraitInput,
	type WithTraitInputValidator,
} from "../validation";

export interface TimeTraitStdHost {
	Date: Pick<DateConstructor, "now">;
	setTimeout(handler: () => void, delayMs: number): unknown;
	clearTimeout(handle: unknown): void;
}

export const TimeTraitStdHostSchema = defineType({
	Date: defineType({
		now: "Function",
	}),
	setTimeout: "Function",
	clearTimeout: "Function",
});

export interface TimeForStdCreateOptions {
	host?: TimeTraitStdHost;
}

const TimeForStdCreateOptionsSchema = defineType({
	host: TimeTraitStdHostSchema,
});

export function createTimeForStd(
	options: TimeForStdCreateOptions &
		WithTraitInputValidator<TraitInputValidator> = {},
): TimeTrait {
	const { validators, ...createOptions } = options;
	const resolvedCreateOptions = {
		host: createOptions.host ?? globalThis,
	};
	validateTraitInput({
		value: resolvedCreateOptions,
		bundledSchema: TimeForStdCreateOptionsSchema,
		validator: validators,
		onInvalid: (failure) =>
			throwValidationClientError({
				code: "time.invalid_std_options",
				source: "time",
				messagePrefix:
					"createTimeForStd could not validate timeForStdCreateOptions",
				failure,
			}),
	});
	const host = resolvedCreateOptions.host;

	return {
		now: () => host.Date.now(),
		setTimeout: (handler, delayMs) => host.setTimeout(handler, delayMs),
		clearTimeout: (handle) => host.clearTimeout(handle as number | undefined),
	};
}
