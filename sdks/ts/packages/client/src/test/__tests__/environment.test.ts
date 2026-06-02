import { describe, expect, it } from "vitest";
import {
	RouterNavigationIntent,
	RouterNavigationMode,
} from "../../router/router";
import { UriReferenceString } from "../../struct/uri-string";
import { TRANSPORT_TRAIT_TOKEN } from "../../transport";
import { createEnvironmentForNativeWeb } from "../../web/environment";
import {
	createEnvironmentForTest,
	createRouterForTest,
	createStorageForTest,
	createTimeForTest,
	createTransportForTest,
} from "../index";

describe("client test environment helpers", () => {
	it("creates a foundation test environment with default span and tracing", () => {
		const environment = createEnvironmentForTest();

		expect(environment.span.id).toMatch(/^span_/);
		expect(typeof environment.tracing.record).toBe("function");
		expect(typeof environment.transport.execute).toBe("function");
	});

	it("creates a native-web test environment with default span and tracing", () => {
		const environment = createEnvironmentForNativeWeb({
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
			createBaseEnvironment: createEnvironmentForNativeWeb,
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

	it("uses test time by default", () => {
		const environment = createEnvironmentForTest();

		expect(environment.time.now()).toBeTypeOf("number");
	});

	it("creates deterministic time for tests", () => {
		const time = createTimeForTest({ initialNow: 10 });
		const calls: string[] = [];

		time.setTimeout(() => calls.push("later"), 5);
		time.advanceAndFlush(4);
		expect(calls).toEqual([]);
		expect(time.pendingCount).toBe(1);

		time.advanceAndFlush(1);
		expect(calls).toEqual(["later"]);
		expect(time.pendingCount).toBe(0);
	});

	it("creates in-memory storage for tests", async () => {
		const storage = createStorageForTest({
			initialEntries: { token: "abc" },
		});

		await expect(storage.get("token")).resolves.toBe("abc");
		await storage.set("token", "def");
		await expect(storage.get("token")).resolves.toBe("def");
		await storage.remove("token");
		await expect(storage.get("token")).resolves.toBeNull();
	});

	it("creates route-based transport for tests", async () => {
		const transport = createTransportForTest().onRequest("GET", "/ok", {
			status: 200,
			headers: {},
			body: { ok: true },
		});

		await expect(
			transport.execute({ url: "/ok/1", method: "GET", headers: {} }),
		).resolves.toMatchObject({ status: 200 });
		await expect(
			transport.execute({ url: "/missing", method: "GET", headers: {} }),
		).resolves.toMatchObject({ status: 404 });
		expect(transport.history).toHaveLength(2);
	});

	it("creates recording router for tests", async () => {
		const router = createRouterForTest({ currentUrl: "/start" });

		await router.navigate({
			url: UriReferenceString.parse("/next"),
			intent: RouterNavigationIntent.PostAuthRedirect,
			mode: RouterNavigationMode.Replace,
			state: { from: "test" },
		});

		expect(router.currentUrl()?.toString()).toBe("/next");
		expect(router.navigations).toHaveLength(1);
		expect(router.navigations[0]?.state).toEqual({ from: "test" });
	});
});
