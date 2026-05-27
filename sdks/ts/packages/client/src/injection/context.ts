import {
	inject as runtimeInject,
	runInInjectionContext as runtimeRunInInjectionContext,
} from "injection-js";
import { toRuntimeInjector } from "./injector";
import {
	type SecuritydeptDependencyToken,
	type SecuritydeptInjectorTrait,
} from "./types";

export interface SecuritydeptInjectOptions {
	optional?: boolean;
}

export function inject<T>(
	token: SecuritydeptDependencyToken<T>,
	options?: SecuritydeptInjectOptions & { optional?: false },
): T;
export function inject<T>(
	token: SecuritydeptDependencyToken<T>,
	options?: SecuritydeptInjectOptions & { optional?: true },
): T | null;
export function inject<T>(
	token: SecuritydeptDependencyToken<T>,
	options?: SecuritydeptInjectOptions,
): T | null {
	if (options?.optional === true) {
		return runtimeInject(token, {
			optional: true,
		});
	}

	return runtimeInject(token);
}

export function tryInjectInInjectionContext<T>(
	token: SecuritydeptDependencyToken<T>,
	options?: SecuritydeptInjectOptions,
): T | null {
	try {
		if (options?.optional === true) {
			return inject(token, { optional: true });
		}

		return inject(token);
	} catch (error) {
		if (isMissingInjectionContextError(error)) {
			return null;
		}

		throw error;
	}
}

export function runInInjectionContext<ReturnT>(
	injector: SecuritydeptInjectorTrait,
	fn: () => ReturnT,
): ReturnT {
	return runtimeRunInInjectionContext(toRuntimeInjector(injector), fn);
}

function isMissingInjectionContextError(error: unknown): boolean {
	return (
		error instanceof Error &&
		error.message.includes("can only be used within an injection context")
	);
}
