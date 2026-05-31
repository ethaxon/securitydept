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
				baseURI: "/relative",
			}),
		).toThrow(/createRouterForAngular could not validate router/);
		expect(() =>
			createRouterForAngular({
				router: { navigateByUrl },
				document: { baseURI: "/relative" },
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

	it("uses only explicit Angular document for default base URI", () => {
		const routerWithoutDocument = createRouterForAngular({
			router: {
				url: "/current",
				navigateByUrl: vi.fn(async () => true),
			},
		});
		const routerWithDocument = createRouterForAngular({
			router: {
				url: "/current",
				navigateByUrl: vi.fn(async () => true),
			},
			document: { baseURI: "https://document.example.com/" },
		});
		const routerWithOverride = createRouterForAngular({
			router: {
				url: "/current",
				navigateByUrl: vi.fn(async () => true),
			},
			document: { baseURI: "https://document.example.com/" },
			baseURI: "https://override.example.com/",
		});

		expect(routerWithoutDocument.baseURI()).toBeNull();
		expect(routerWithDocument.baseURI()?.toString()).toBe(
			"https://document.example.com/",
		);
		expect(routerWithOverride.baseURI()?.toString()).toBe(
			"https://override.example.com/",
		);
	});

	it("reads Angular document base URI dynamically when base URI is not explicit", () => {
		const documentHost = { baseURI: "https://initial.example.com/" };
		const router = createRouterForAngular({
			router: {
				url: "/current",
				navigateByUrl: vi.fn(async () => true),
			},
			document: documentHost,
		});

		expect(router.baseURI()?.toString()).toBe("https://initial.example.com/");
		documentHost.baseURI = "https://next.example.com/";
		expect(router.baseURI()?.toString()).toBe("https://next.example.com/");
	});

	it("builds a RouterTrait from Angular navigation", async () => {
		const navigateByUrl = vi.fn(async () => true);
		const router = createRouterForAngular({
			router: {
				url: "/current",
				navigateByUrl,
			},
			baseURI: "https://app.example.com/",
		});

		expect(router.currentUrl()?.toString()).toBe("/current");
		expect(router.baseURI()?.toString()).toBe("https://app.example.com/");
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
});
