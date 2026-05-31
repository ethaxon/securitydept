import {
	createEnvironmentInjector,
	Injector,
	inject,
	runInInjectionContext,
} from "@angular/core";
import {
	SecuritydeptInjectionToken,
	type SecuritydeptProvider,
} from "@securitydept/client";
import { type NativeWebEnvironment } from "@securitydept/client/web";
import {
	ENVIRONMENT,
	provideEnvironment,
	provideEnvironmentProvider,
} from "@securitydept/client-angular";
import { describe, expect, it, vi } from "vitest";
import { createEnvironmentForNativeWebTest } from "../../../../client/src/test";

const TEST_ENVIRONMENT_EXTENSION = new SecuritydeptInjectionToken<string>(
	"TEST_ENVIRONMENT_EXTENSION",
);

function createTransport() {
	return {
		execute: vi.fn(async () => ({
			status: 200,
			headers: {},
			body: null,
		})),
	};
}

function createTime() {
	return {
		now: () => Date.now(),
		setTimeout: (callback: () => void, delayMs: number) =>
			globalThis.setTimeout(callback, delayMs),
		clearTimeout: (handle: unknown) =>
			globalThis.clearTimeout(
				handle as ReturnType<typeof globalThis.setTimeout>,
			),
	};
}

function createNativeWebEnvironment(
	providers: readonly SecuritydeptProvider[] = [],
): NativeWebEnvironment {
	return createEnvironmentForNativeWebTest({
		providers,
		transport: createTransport(),
		time: createTime(),
		routerForNativeWebCreateOptions: {
			location: {
				href: "https://app.example.com/current",
				hash: "",
				pathname: "/current",
				search: "",
			},
			history: {
				replaceState() {},
			},
		},
	});
}

describe("client-angular environment bridge", () => {
	it("provides the host-owned native web environment object", () => {
		let environment: NativeWebEnvironment | undefined;
		const injector = createEnvironmentInjector(
			[
				provideEnvironment({
					environment: (ngProviders) => {
						environment = createNativeWebEnvironment(ngProviders);
						return environment;
					},
				}),
			],
			Injector.NULL as never,
		);

		try {
			const resolved = runInInjectionContext(injector, () =>
				inject(ENVIRONMENT),
			);
			expect(resolved).toBe(environment);
			expect(resolved.injector.get(Injector)).toBe(injector);
		} finally {
			injector.destroy();
		}
	});

	it("collects external Securitydept providers into the environment factory", () => {
		const injector = createEnvironmentInjector(
			[
				provideEnvironmentProvider({
					provide: TEST_ENVIRONMENT_EXTENSION,
					useValue: "from-angular-provider",
				}),
				provideEnvironment({
					environment: (ngProviders) => createNativeWebEnvironment(ngProviders),
				}),
			],
			Injector.NULL as never,
		);

		try {
			const resolved = runInInjectionContext(injector, () =>
				inject(ENVIRONMENT),
			);
			expect(resolved.injector.get(TEST_ENVIRONMENT_EXTENSION)).toBe(
				"from-angular-provider",
			);
			expect(resolved.injector.get(Injector)).toBe(injector);
		} finally {
			injector.destroy();
		}
	});

	it("fails fast when no native web environment is provided", () => {
		const injector = createEnvironmentInjector([], Injector.NULL as never);

		try {
			expect(() =>
				runInInjectionContext(injector, () => inject(ENVIRONMENT)),
			).toThrow(/No provider.*ENVIRONMENT|NullInjectorError/);
		} finally {
			injector.destroy();
		}
	});
});
