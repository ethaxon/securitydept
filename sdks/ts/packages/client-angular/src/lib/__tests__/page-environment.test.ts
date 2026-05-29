import {
	createEnvironmentInjector,
	Injector,
	inject,
	runInInjectionContext,
} from "@angular/core";
import { type NativeWebEnvironment } from "@securitydept/client/web";
import { ENVIRONMENT, provideEnvironment } from "@securitydept/client-angular";
import { describe, expect, it, vi } from "vitest";
import { createEnvironmentForNativeWebTest } from "../../../../client/src/test";

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
	return createEnvironmentForNativeWebTest({
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
		const environment = createNativeWebEnvironment();
		const injector = createEnvironmentInjector(
			[provideEnvironment({ environment })],
			Injector.NULL as never,
		);

		try {
			expect(runInInjectionContext(injector, () => inject(ENVIRONMENT))).toBe(
				environment,
			);
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
