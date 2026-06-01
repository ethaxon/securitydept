import { HttpClient, HttpResponse } from "@angular/common/http";
import {
	createEnvironmentInjector,
	Injector,
	inject,
	runInInjectionContext,
} from "@angular/core";
import { Router } from "@angular/router";
import {
	ROUTER_TRAIT_TOKEN,
	SecuritydeptInjectionToken,
	type SecuritydeptProvider,
	TRANSPORT_TRAIT_TOKEN,
} from "@securitydept/client";
import { type NativeWebEnvironment } from "@securitydept/client/web";
import {
	createEnvironmentForAngular,
	ENVIRONMENT,
	provideEnvironment,
	provideEnvironmentProvider,
} from "@securitydept/client-angular";
import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { createEnvironmentForNativeWebTest } from "../../../../client/src/test";

const TEST_ENVIRONMENT_EXTENSION = new SecuritydeptInjectionToken<string>(
	"TEST_ENVIRONMENT_EXTENSION",
);
const TEST_ENVIRONMENT_EXTENSION_FROM_OPTIONS =
	new SecuritydeptInjectionToken<string>(
		"TEST_ENVIRONMENT_EXTENSION_FROM_OPTIONS",
	);

function provideAngularEnvironmentDeps() {
	return [provideRouterDep(), provideHttpClientDep()];
}

function provideRouterDep() {
	return {
		provide: Router,
		useValue: {
			url: "/current",
			navigateByUrl: vi.fn(async () => true),
		},
	};
}

function provideHttpClientDep() {
	return {
		provide: HttpClient,
		useValue: {
			request: vi.fn(() =>
				of(
					new HttpResponse({
						status: 200,
						body: "",
					}),
				),
			),
		},
	};
}

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
	options: { providers?: readonly SecuritydeptProvider[] } = {},
): NativeWebEnvironment {
	return createEnvironmentForNativeWebTest({
		...options,
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
				...provideAngularEnvironmentDeps(),
				provideEnvironment({
					createBaseEnvironment: (options) => {
						environment = createNativeWebEnvironment(options);
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
				...provideAngularEnvironmentDeps(),
				provideEnvironmentProvider({
					provide: TEST_ENVIRONMENT_EXTENSION,
					useValue: "from-angular-provider",
				}),
				provideEnvironment({
					createBaseEnvironment: createNativeWebEnvironment,
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

	it("merges options providers with ENVIRONMENT_PROVIDER entries", () => {
		const injector = createEnvironmentInjector(
			[
				...provideAngularEnvironmentDeps(),
				provideEnvironmentProvider({
					provide: TEST_ENVIRONMENT_EXTENSION,
					useValue: "from-environment-provider",
				}),
				provideEnvironment({
					createBaseEnvironment: createNativeWebEnvironment,
					providers: [
						{
							provide: TEST_ENVIRONMENT_EXTENSION_FROM_OPTIONS,
							useValue: "from-options",
						},
					],
				}),
			],
			Injector.NULL as never,
		);

		try {
			const resolved = runInInjectionContext(injector, () =>
				inject(ENVIRONMENT),
			);
			expect(resolved.injector.get(TEST_ENVIRONMENT_EXTENSION)).toBe(
				"from-environment-provider",
			);
			expect(
				resolved.injector.get(TEST_ENVIRONMENT_EXTENSION_FROM_OPTIONS),
			).toBe("from-options");
		} finally {
			injector.destroy();
		}
	});

	it("includes default Angular router and transport trait providers", () => {
		const injector = createEnvironmentInjector(
			[
				...provideAngularEnvironmentDeps(),
				provideEnvironment({
					createBaseEnvironment: createNativeWebEnvironment,
				}),
			],
			Injector.NULL as never,
		);

		try {
			const resolved = runInInjectionContext(injector, () =>
				inject(ENVIRONMENT),
			);
			expect(resolved.injector.get(ROUTER_TRAIT_TOKEN)).toBe(resolved.router);
			expect(resolved.injector.get(TRANSPORT_TRAIT_TOKEN)).toBe(
				resolved.transport,
			);
			const router = resolved.router;
			if (!router) {
				throw new Error("Expected default Angular router trait.");
			}
			expect(router.currentUrl()?.toString()).toBe("/current");
			expect(router.baseURI()).toBeNull();
		} finally {
			injector.destroy();
		}
	});

	it("lets provideEnvironment options override injected Angular create options", async () => {
		const httpClient = {
			request: vi.fn(() =>
				of(
					new HttpResponse({
						status: 200,
						body: "",
					}),
				),
			),
		};
		const injector = createEnvironmentInjector(
			[
				provideRouterDep(),
				{
					provide: HttpClient,
					useValue: httpClient,
				},
				provideEnvironment({
					createBaseEnvironment: createNativeWebEnvironment,
					routerForAngularCreateOptions: {
						currentUrl: "/override",
						baseURI: "https://app.example.com/base/",
					},
					transportForAngularCreateOptions: {
						baseUrl: "https://api.example.com",
					},
				}),
			],
			Injector.NULL as never,
		);

		try {
			const resolved = runInInjectionContext(injector, () =>
				inject(ENVIRONMENT),
			);
			expect(resolved.router?.currentUrl()?.toString()).toBe("/override");
			expect(resolved.router?.baseURI()?.toString()).toBe(
				"https://app.example.com/base/",
			);

			await resolved.transport.execute({
				url: "/resource",
				method: "GET",
				headers: {},
			});
			expect(httpClient.request).toHaveBeenCalledWith(
				"GET",
				"https://api.example.com/resource",
				expect.any(Object),
			);
		} finally {
			injector.destroy();
		}
	});

	it("allows explicit SecurityDept providers to override default Angular traits", () => {
		const explicitRouter = createNativeWebEnvironment().router;
		const explicitTransport = createTransport();
		const injector = createEnvironmentInjector(
			[
				...provideAngularEnvironmentDeps(),
				provideEnvironmentProvider({
					provide: ROUTER_TRAIT_TOKEN,
					useValue: explicitRouter,
				}),
				provideEnvironmentProvider({
					provide: TRANSPORT_TRAIT_TOKEN,
					useValue: explicitTransport,
				}),
				provideEnvironment({
					createBaseEnvironment: createNativeWebEnvironment,
				}),
			],
			Injector.NULL as never,
		);

		try {
			const resolved = runInInjectionContext(injector, () =>
				inject(ENVIRONMENT),
			);
			expect(resolved.router).toBe(explicitRouter);
			expect(resolved.transport).toBe(explicitTransport);
		} finally {
			injector.destroy();
		}
	});

	it("requires Angular Router for the default router trait provider", () => {
		const injector = createEnvironmentInjector(
			[
				provideHttpClientDep(),
				provideEnvironment({
					createBaseEnvironment: createNativeWebEnvironment,
				}),
			],
			Injector.NULL as never,
		);

		try {
			expect(() =>
				runInInjectionContext(injector, () => inject(ENVIRONMENT)),
			).toThrow(/No provider.*Router|NullInjectorError/);
		} finally {
			injector.destroy();
		}
	});

	it("requires Angular HttpClient for the default transport trait provider", () => {
		const injector = createEnvironmentInjector(
			[
				provideRouterDep(),
				provideEnvironment({
					createBaseEnvironment: createNativeWebEnvironment,
				}),
			],
			Injector.NULL as never,
		);

		try {
			expect(() =>
				runInInjectionContext(injector, () => inject(ENVIRONMENT)),
			).toThrow(/No provider.*HttpClient|NullInjectorError/);
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

	it("creates an Angular environment over a base creator", () => {
		const explicitProvider = {
			provide: TEST_ENVIRONMENT_EXTENSION,
			useValue: "direct-create",
		};
		const router = {
			url: "/direct",
			navigateByUrl: vi.fn(async () => true),
		};
		const httpClient = provideHttpClientDep().useValue;
		const environment = createEnvironmentForAngular({
			createBaseEnvironment: createNativeWebEnvironment,
			routerForAngularCreateOptions: { router },
			transportForAngularCreateOptions: { httpClient },
			providers: [explicitProvider],
		});

		expect(environment.router.currentUrl()?.toString()).toBe("/direct");
		expect(environment.injector.get(TEST_ENVIRONMENT_EXTENSION)).toBe(
			"direct-create",
		);
	});
});
