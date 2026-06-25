import { UriReferenceString } from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import { createRouterForAngular } from "../router";

describe("Angular router adapter", () => {
	it("validates malformed Angular router hosts", () => {
		expect(() => createRouterForAngular({ router: {} as never })).toThrow(
			/createRouterForAngular could not validate router/,
		);
		expect(() => createRouterForAngular({ router: null as never })).toThrow(
			/createRouterForAngular could not validate router/,
		);
	});

	it("validates router URL and URI options through bundled schemas", () => {
		const navigateByUrl = vi.fn(async () => true);
		expect(() =>
			createRouterForAngular({
				router: { url: 42 as never, navigateByUrl },
			}),
		).toThrow(/createRouterForAngular could not validate router/);
		expect(() =>
			createRouterForAngular({
				router: { navigateByUrl },
				currentUrl: "http://[",
			}),
		).toThrow(/createRouterForAngular could not validate router/);
	});

	it("preserves configured empty URI reference", () => {
		const router = createRouterForAngular({
			router: {
				url: "/current",
				navigateByUrl: vi.fn(async () => true),
			},
			currentUrl: "",
		});

		expect(router.currentUrl()?.toString()).toBe("");
	});

	it("uses explicit current URL instead of falling back during build", () => {
		const router = createRouterForAngular({
			router: {
				url: "/current",
				navigateByUrl: vi.fn(async () => true),
			},
			currentUrl: null,
		});

		expect(router.currentUrl()).toBeNull();
	});

	it("reads router URL dynamically when current URL is not explicit", () => {
		const routerHost = {
			url: "/initial",
			navigateByUrl: vi.fn(async () => true),
		};
		const router = createRouterForAngular({ router: routerHost });

		expect(router.currentUrl()?.toString()).toBe("/initial");
		routerHost.url = "/next";
		expect(router.currentUrl()?.toString()).toBe("/next");
	});

	it("builds a RouterTrait from Angular navigation", async () => {
		const navigateByUrl = vi.fn(async () => true);
		const router = createRouterForAngular({
			router: {
				url: "/current",
				navigateByUrl,
			},
		});

		expect(router.currentUrl()?.toString()).toBe("/current");
		await router.navigate({
			url: UriReferenceString.parse("/next"),
			intent: "post_auth_redirect",
			mode: "replace",
			state: { from: "test" },
		});
		expect(navigateByUrl).toHaveBeenCalledWith("/next", {
			replaceUrl: true,
			state: { from: "test" },
		});
	});

	it("delegates external navigation to the native web router", async () => {
		const navigateByUrl = vi.fn(async () => true);
		const location = { href: "https://app.example.com/current" };
		const router = createRouterForAngular({
			router: {
				url: "/current",
				navigateByUrl,
			},
			navigation: null,
			location,
			history: null,
			window: null,
		});

		await router.navigate({
			url: UriReferenceString.parse(
				"https://idp.example.com/authorize?client_id=web",
			),
			intent: "auth_redirect",
			mode: "external",
		});

		expect(location.href).toBe(
			"https://idp.example.com/authorize?client_id=web",
		);
		expect(navigateByUrl).not.toHaveBeenCalled();
	});

	it("fails external navigation when native web routing is unavailable", async () => {
		const router = createRouterForAngular({
			router: {
				navigateByUrl: vi.fn(async () => true),
			},
			navigation: null,
			location: null,
			history: null,
			window: null,
		});

		await expect(
			router.navigate({
				url: UriReferenceString.parse("https://idp.example.com/authorize"),
				intent: "auth_redirect",
				mode: "external",
			}),
		).rejects.toMatchObject({
			code: "client_angular.router.native_web_router_unavailable",
		});
	});
});
