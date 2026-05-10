import {
	createEnvironmentInjector,
	InjectionToken,
	Injector,
	inject,
	runInInjectionContext,
} from "@angular/core";
import {
	ClientEnvironmentService,
	createBrowserPageClientEnvironment,
	createWebClientEnvironment,
	deriveClientEnvironment,
	type PageClientEnvironment,
	type WebClientEnvironment,
} from "@securitydept/client/web";
import {
	PAGE_CLIENT_ENVIRONMENT,
	providePageClientEnvironment,
	resolvePageClientEnvironmentSource,
} from "@securitydept/client-angular";
import { describe, expect, it, vi } from "vitest";

function createTransport() {
	return {
		execute: vi.fn(async () => ({
			status: 200,
			headers: {},
			body: null,
		})),
	};
}

function createScheduler() {
	return {
		setTimeout() {
			return { cancel() {} };
		},
	};
}

function createPageEnvironment(): PageClientEnvironment {
	const webEnvironment = createWebClientEnvironment({
		transport: createTransport(),
		scheduler: createScheduler(),
		clock: { now: () => Date.now() },
	});

	return createBrowserPageClientEnvironment({
		pageCapability: {
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
		...deriveClientEnvironment(webEnvironment),
	});
}

function createPageEnvironmentService() {
	return new ClientEnvironmentService({
		createClientEnvironment: (): WebClientEnvironment =>
			createWebClientEnvironment({
				transport: createTransport(),
				scheduler: createScheduler(),
				clock: { now: () => Date.now() },
			}),
		createPageEnvironment: (webEnvironment) =>
			createBrowserPageClientEnvironment({
				pageCapability: {
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
				...deriveClientEnvironment(webEnvironment),
			}),
	});
}

describe("client-angular page environment bridge", () => {
	it("resolves an already-materialized page environment source", async () => {
		const environment = createPageEnvironment();
		const injector = createEnvironmentInjector(
			[providePageClientEnvironment({ environment })],
			Injector.NULL as never,
		);

		try {
			await expect(
				runInInjectionContext(injector, () =>
					resolvePageClientEnvironmentSource(
						inject(PAGE_CLIENT_ENVIRONMENT, { optional: true }) ?? undefined,
						() => {
							throw new Error("missing page environment");
						},
					),
				),
			).resolves.toBe(environment);
		} finally {
			injector.destroy();
		}
	});

	it("resolves a provider-scoped ClientEnvironmentService source", async () => {
		const environmentService = createPageEnvironmentService();
		const injector = createEnvironmentInjector(
			[providePageClientEnvironment({ environment: environmentService })],
			Injector.NULL as never,
		);

		try {
			const environment = await runInInjectionContext(injector, () =>
				resolvePageClientEnvironmentSource(
					inject(PAGE_CLIENT_ENVIRONMENT, { optional: true }) ?? undefined,
					() => {
						throw new Error("missing page environment");
					},
				),
			);
			expect(environment).toBe(
				await environmentService.resolvePageEnvironment(),
			);
		} finally {
			injector.destroy();
		}
	});

	it("resolves an inject-safe resolver source", async () => {
		const TEST_PAGE_ENVIRONMENT_SERVICE =
			new InjectionToken<ClientEnvironmentService>(
				"TEST_PAGE_ENVIRONMENT_SERVICE",
			);
		const environmentService = createPageEnvironmentService();
		const injector = createEnvironmentInjector(
			[
				{
					provide: TEST_PAGE_ENVIRONMENT_SERVICE,
					useValue: environmentService,
				},
				providePageClientEnvironment({
					environment: () =>
						inject(TEST_PAGE_ENVIRONMENT_SERVICE).resolvePageEnvironment(),
				}),
			],
			Injector.NULL as never,
		);

		try {
			const environment = await runInInjectionContext(injector, () =>
				resolvePageClientEnvironmentSource(
					inject(PAGE_CLIENT_ENVIRONMENT, { optional: true }) ?? undefined,
					() => {
						throw new Error("missing page environment");
					},
				),
			);
			expect(environment).toBe(
				await environmentService.resolvePageEnvironment(),
			);
		} finally {
			injector.destroy();
		}
	});

	it("fails fast when no page environment source is provided", () => {
		const injector = createEnvironmentInjector([], Injector.NULL as never);

		try {
			expect(() =>
				runInInjectionContext(injector, () =>
					resolvePageClientEnvironmentSource(
						inject(PAGE_CLIENT_ENVIRONMENT, { optional: true }) ?? undefined,
						() => {
							throw new Error(
								"Provide it once from the Angular composition root with providePageClientEnvironment({ environment }).",
							);
						},
					),
				),
			).toThrow(/providePageClientEnvironment/);
		} finally {
			injector.destroy();
		}
	});
});
