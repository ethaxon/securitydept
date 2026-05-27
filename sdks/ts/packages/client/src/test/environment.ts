import {
	type CreateFoundationEnvironmentOptions,
	createFoundationEnvironment,
} from "../environment/create";
import { type FoundationEnvironment } from "../environment/types";
import { type BaseTransportTrait } from "../transport/types";

export interface CreateEnvironmentForTestOptions
	extends Omit<CreateFoundationEnvironmentOptions, "transport"> {
	transport?: BaseTransportTrait;
}

export function createEnvironmentForTest(
	options: CreateEnvironmentForTestOptions = {},
): FoundationEnvironment {
	return createFoundationEnvironment({
		...options,
		transport: options.transport ?? createMissingTransportForTest(),
	});
}

function createMissingTransportForTest(): BaseTransportTrait {
	return {
		async execute() {
			throw new Error("Test environment transport was not provided.");
		},
	};
}
