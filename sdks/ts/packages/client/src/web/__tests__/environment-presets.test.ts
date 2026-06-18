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
			history: { replaceState() {}, pushState() {} },
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

	it("omits native web router when page capabilities are unavailable", () => {
		const environment = createEnvironmentForNativeWeb({
			...createEnvironmentOptions(),
			routerForNativeWebCreateOptions: {
				navigation: null,
				location: null,
				history: null,
				window: null,
			},
		});

		expect(environment.router).toBeUndefined();
	});
});
