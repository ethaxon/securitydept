import type { EnvironmentValidators } from "../../environment/validators";
import { validateEnvTraitInput } from "../../environment/validators";
import { createDefaultTimeConfig } from "../../scheduling/default-time-config";
import type { TimeTrait } from "../../scheduling/types";

export interface CreateTimeForStdOptions {
	validators?: Pick<EnvironmentValidators, "time">;
}

export function createTimeForStd(
	options: CreateTimeForStdOptions = {},
): TimeTrait {
	validateEnvTraitInput({
		traitName: "time",
		hostAdapter: "createTimeForStd",
		value: globalThis,
		validator: options.validators?.time,
		bundleValidate: (value) => {
			const host = value as typeof globalThis;
			return (
				typeof host.Date.now === "function" &&
				typeof host.setTimeout === "function" &&
				typeof host.clearTimeout === "function"
			);
		},
	});
	return createDefaultTimeConfig();
}
