import { describe, expect, it } from "vitest";
import { createInMemoryRecordStore } from "../../storage";
import {
	createEnvironmentForNativeWeb,
	type FoundationEnvironment,
	type NativeWebEnvironment,
} from "../environment";

function createTransport() {
	return {
		async execute() {
			return { status: 204, headers: {}, body: null };
		},
	};
}

function createEnvironmentOptions() {
	return {
		transport: createTransport(),
		persistentStorage: createInMemoryRecordStore(),
		sessionStorage: createInMemoryRecordStore(),
	};
}

describe("environment factory shape", () => {
	it("creates a native web environment as a typed superset of foundation environments", () => {
		const nativeWebPage = {
			location: {
				href: "https://app.example.com/dashboard",
				hash: "",
			},
			history: { replaceState() {} },
		};
		const environment = createEnvironmentForNativeWeb({
			...createEnvironmentOptions(),
			routerForNativeWebCreateOptions: {
				location: nativeWebPage.location,
				history: nativeWebPage.history,
			},
		});

		const asNativeWeb: NativeWebEnvironment = environment;
		const asFoundation: FoundationEnvironment = environment;

		expect(asNativeWeb.router.currentUrl()?.toString()).toBe(
			nativeWebPage.location.href,
		);
		expect(asFoundation.transport).toBe(environment.transport);
		expect(environment.persistentStorage).toBeDefined();
		expect(environment.sessionStorage).toBeDefined();
	});

	it("requires native web page capabilities instead of creating page-free native web environments", () => {
		expect(() =>
			createEnvironmentForNativeWeb(createEnvironmentOptions()),
		).toThrow(/createRouterForNativeWeb could not validate router/);
	});
});
