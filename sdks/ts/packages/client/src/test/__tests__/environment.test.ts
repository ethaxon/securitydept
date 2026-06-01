import { describe, expect, it } from "vitest";
import { TRANSPORT_TRAIT_TOKEN } from "../../transport";
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

	it("adds the test transport before delegating to a base environment", async () => {
		const environment = createEnvironmentForTest({
			createBaseEnvironment: createEnvironmentForNativeWebTest,
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

		await expect(
			environment.transport.execute({
				url: "https://api.example.com/",
				method: "GET",
				headers: {},
			}),
		).rejects.toThrow("Test environment transport was not provided.");
		expect(environment.router.currentUrl()?.toString()).toBe(
			"https://app.example.com/dashboard",
		);
	});

	it("keeps explicit transport providers ahead of the test transport", async () => {
		const transport = {
			async execute() {
				return { status: 299, headers: {}, body: null };
			},
		};
		const environment = createEnvironmentForTest({
			providers: [{ provide: TRANSPORT_TRAIT_TOKEN, useValue: transport }],
		});

		await expect(
			environment.transport.execute({
				url: "https://api.example.com/",
				method: "GET",
				headers: {},
			}),
		).resolves.toMatchObject({ status: 299 });
		expect(environment.transport).toBe(transport);
	});
});
