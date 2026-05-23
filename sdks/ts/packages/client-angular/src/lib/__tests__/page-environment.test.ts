import {
	createEnvironmentInjector,
	Injector,
	inject,
	runInInjectionContext,
} from "@angular/core";
import {
	createEnvironmentForNativeWeb,
	type NativeWebEnvironment,
} from "@securitydept/client/web";
import {
	NATIVE_WEB_ENVIRONMENT,
	provideNativeWebEnvironment,
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

function createNativeWebEnvironment(): NativeWebEnvironment {
	return createEnvironmentForNativeWeb({
		transport: createTransport(),
		time: createTime(),
		location: {
			href: "https://app.example.com/current",
			hash: "",
			pathname: "/current",
			search: "",
		},
		history: {
			replaceState() {},
		},
	});
}

describe("client-angular native web environment bridge", () => {
	it("provides the host-owned native web environment object", () => {
		const environment = createNativeWebEnvironment();
		const injector = createEnvironmentInjector(
			[provideNativeWebEnvironment({ environment })],
			Injector.NULL as never,
		);

		try {
			expect(
				runInInjectionContext(injector, () =>
					inject(NATIVE_WEB_ENVIRONMENT, { optional: true }),
				),
			).toBe(environment);
		} finally {
			injector.destroy();
		}
	});

	it("fails fast when no native web environment is provided", () => {
		const injector = createEnvironmentInjector([], Injector.NULL as never);

		try {
			expect(() =>
				runInInjectionContext(injector, () => {
					const environment = inject(NATIVE_WEB_ENVIRONMENT, {
						optional: true,
					});
					if (!environment) {
						throw new Error(
							"Provide it once from the Angular composition root with provideNativeWebEnvironment({ environment }).",
						);
					}
					return environment;
				}),
			).toThrow(/provideNativeWebEnvironment/);
		} finally {
			injector.destroy();
		}
	});
});
