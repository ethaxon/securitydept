import { type as defineType } from "arktype";
import { type EnvironmentValidators } from "../environment/types";
import { createInMemoryRecordStore } from "../storage/memory-store";
import { type StorageTrait } from "../storage/types";
import {
	throwValidationClientError,
	validateTraitInput,
	type WithTraitInputValidator,
} from "../validation";

export interface StorageForTestCreateOptions {
	initialEntries?: Record<string, string>;
	validatorKey?: "persistentStorage" | "sessionStorage";
}

const StorageForTestCreateOptionsSchema = defineType({
	initialEntries: "object",
	validatorKey: "'persistentStorage' | 'sessionStorage'",
});

export function createStorageForTest(
	options: StorageForTestCreateOptions &
		WithTraitInputValidator<
			Pick<EnvironmentValidators, "persistentStorage" | "sessionStorage">
		> = {},
): StorageTrait {
	const { validators, ...createOptions } = options;
	const validatorKey = options.validatorKey ?? "persistentStorage";
	const resolvedCreateOptions = {
		initialEntries: createOptions.initialEntries ?? {},
		validatorKey,
	};
	validateTraitInput({
		value: resolvedCreateOptions,
		bundledSchema: StorageForTestCreateOptionsSchema,
		validator: validators?.[validatorKey],
		onInvalid: (failure) =>
			throwValidationClientError({
				code: "test.storage.invalid_options",
				source: "test",
				messagePrefix: `createStorageForTest could not validate ${validatorKey}`,
				failure,
			}),
	});
	const storage = createInMemoryRecordStore();
	for (const [key, value] of Object.entries(
		resolvedCreateOptions.initialEntries,
	)) {
		void storage.set(key, value);
	}
	return storage;
}
