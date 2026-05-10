import { InjectionToken, type Provider } from "@angular/core";
import {
	assertResolveEnvironment,
	type PageClientEnvironment,
} from "@securitydept/client/web";

export type PageClientEnvironmentValue = PageClientEnvironment;

export interface PageClientEnvironmentService {
	resolvePageEnvironment(): Promise<PageClientEnvironmentValue>;
}

export type PageClientEnvironmentResolver = () =>
	| PageClientEnvironmentValue
	| Promise<PageClientEnvironmentValue>;

export type PageClientEnvironmentSource =
	| PageClientEnvironmentValue
	| PageClientEnvironmentService
	| PageClientEnvironmentResolver;

export const PAGE_CLIENT_ENVIRONMENT = new InjectionToken<
	PageClientEnvironmentSource | undefined
>("PAGE_CLIENT_ENVIRONMENT", {
	providedIn: "root",
	factory: () => undefined,
});

export interface ProvidePageClientEnvironmentOptions {
	/**
	 * Stable host-owned page environment source used by Angular page-only helpers.
	 *
	 * Accepts an already-materialized page environment object, a provider-scoped
	 * `ClientEnvironmentService`, or an inject-safe stable resolver returning the
	 * page capability synchronously or asynchronously.
	 */
	environment: PageClientEnvironmentSource;
}

export function providePageClientEnvironment(
	options: ProvidePageClientEnvironmentOptions,
): Provider {
	return {
		provide: PAGE_CLIENT_ENVIRONMENT,
		useValue: options.environment,
	};
}

export function resolvePageClientEnvironmentSource(
	source: PageClientEnvironmentSource | undefined,
	onMissing: () => never,
): Promise<PageClientEnvironmentValue> {
	const resolvedSource = assertResolveEnvironment(source, onMissing);

	if (isPageClientEnvironmentResolver(resolvedSource)) {
		return Promise.resolve(resolvedSource()).then((environment) =>
			assertResolveEnvironment(environment, onMissing),
		);
	}

	if (isPageClientEnvironmentService(resolvedSource)) {
		return resolvedSource
			.resolvePageEnvironment()
			.then((environment) => assertResolveEnvironment(environment, onMissing));
	}

	return Promise.resolve(resolvedSource);
}

function isPageClientEnvironmentResolver(
	source: PageClientEnvironmentSource,
): source is PageClientEnvironmentResolver {
	return typeof source === "function";
}

function isPageClientEnvironmentService(
	source: PageClientEnvironmentSource,
): source is PageClientEnvironmentService {
	return (
		typeof source === "object" &&
		source !== null &&
		"resolvePageEnvironment" in source &&
		typeof source.resolvePageEnvironment === "function"
	);
}
