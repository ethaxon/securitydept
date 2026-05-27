import { describe, expect, it } from "vitest";
import {
	createEnvironmentForNativeWebTest,
	createEnvironmentForTest,
} from "../index";

describe("client test environment helpers", () => {
	it("creates a foundation test environment with default span and tracing", () => {
		const environment = createEnvironmentForTest();

		expect(environment.span.id).toMatch(/^span_/);
		expect(typeof environment.tracing.record).toBe("function");
		expect(typeof environment.transport.execute).toBe("function");
	});

	it("creates a native-web test environment with default span and tracing", () => {
		const environment = createEnvironmentForNativeWebTest({
			routerForNativeWebCreateOptions: {
				location: {
					href: "https://app.example.com/dashboard",
					hash: "",
					pathname: "/dashboard",
					search: "",
				},
				history: {
					replaceState() {},
				},
			},
		});

		expect(environment.router.currentUrl()?.toString()).toBe(
			"https://app.example.com/dashboard",
		);
		expect(environment.span.id).toMatch(/^span_/);
		expect(typeof environment.tracing.record).toBe("function");
	});
});
