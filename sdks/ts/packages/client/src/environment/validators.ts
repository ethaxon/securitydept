import type { StandardSchemaV1 } from "@standard-schema/spec";
import { ClientError, ClientErrorKind, UserRecovery } from "../errors";
import { validateWithSchemaSync } from "../validation";

export type SecuritydeptEnvTraitInputValidator<T> =
	| "bundle"
	| StandardSchemaV1<unknown, T>;

export interface EnvironmentValidators {
	transport?: SecuritydeptEnvTraitInputValidator<unknown>;
	time?: SecuritydeptEnvTraitInputValidator<unknown>;
	idleCallback?: SecuritydeptEnvTraitInputValidator<unknown>;
	persistentStorage?: SecuritydeptEnvTraitInputValidator<unknown>;
	sessionStorage?: SecuritydeptEnvTraitInputValidator<unknown>;
	spanContext?: SecuritydeptEnvTraitInputValidator<unknown>;
	telemetry?: SecuritydeptEnvTraitInputValidator<unknown>;
	router?: SecuritydeptEnvTraitInputValidator<unknown>;
	pageLifecycle?: SecuritydeptEnvTraitInputValidator<unknown>;
	popup?: SecuritydeptEnvTraitInputValidator<unknown>;
}

export interface ValidateEnvTraitInputOptions<T> {
	traitName: string;
	hostAdapter: string;
	/**
	 * Already-resolved adapter input.
	 *
	 * Callers must finish all host/global fallback resolution before invoking
	 * `validateEnvTraitInput()`. Validators operate on this final input only.
	 */
	value: unknown;
	validator?: SecuritydeptEnvTraitInputValidator<T>;
	/**
	 * Built-in structural validator.
	 *
	 * This callback must validate `value` only. It must not read host globals,
	 * caller options, or any other closed-over context to "finish" capability
	 * discovery, because that would make validation disagree with the explicit
	 * adapter input object.
	 */
	bundleValidate(value: unknown): boolean;
}

export function validateEnvTraitInput<T>(
	options: ValidateEnvTraitInputOptions<T>,
): void {
	const validator = options.validator ?? "bundle";
	if (validator === "bundle") {
		if (options.bundleValidate(options.value)) {
			return;
		}
		throwEnvTraitValidationError(options);
	}

	const result = validateWithSchemaSync(validator, options.value);
	if (result.success) {
		return;
	}
	throwEnvTraitValidationError(options);
}

function throwEnvTraitValidationError(options: {
	traitName: string;
	hostAdapter: string;
}): never {
	throw new ClientError({
		kind: ClientErrorKind.Configuration,
		code: "environment.trait_validation_failed",
		message: `${options.hostAdapter} could not validate ${options.traitName}.`,
		recovery: UserRecovery.RestartFlow,
		source: "environment",
	});
}
