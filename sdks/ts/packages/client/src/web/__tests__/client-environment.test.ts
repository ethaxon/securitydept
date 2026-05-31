import { describe, expect, it } from "vitest";
import { createFoundationEnvironment } from "../../environment/create";
import { createInMemoryRecordStore } from "../../storage";
import { UriReferenceString } from "../../struct/uri-string";
import { createTimeForTest } from "../../test";
import { createEnvironmentForNativeWeb } from "../environment";

function createTransport() {
	return {
		async execute() {
			return { status: 204, headers: {}, body: null };
		},
	};
}

describe("environment page capability boundary", () => {
	it("accepts explicit fake page capabilities", () => {
		const nativeWebPage = {
			location: {
				href: "https://app.example.com/callback#fragment",
				hash: "#fragment",
			},
			history: { replaceState() {} },
		};

		const environment = createEnvironmentForNativeWeb({
			transport: createTransport(),
			persistentStorage: createInMemoryRecordStore(),
			sessionStorage: createInMemoryRecordStore(),
			routerForNativeWebCreateOptions: {
				location: nativeWebPage.location,
				history: nativeWebPage.history,
			},
		});

		expect(environment.router.currentUrl()?.toString()).toBe(
			nativeWebPage.location.href,
		);
	});

	it("keeps foundation environments page-free", () => {
		const environment = createFoundationEnvironment({
			persistentStorage: createInMemoryRecordStore(),
			sessionStorage: createInMemoryRecordStore(),
		});

		expect("location" in environment).toBe(false);
		expect("history" in environment).toBe(false);
	});

	it("leaves history requirements to the native web router adapter", async () => {
		const environment = createEnvironmentForNativeWeb({
			transport: createTransport(),
			routerForNativeWebCreateOptions: {
				location: {
					href: "https://app.example.com/callback#fragment",
					hash: "#fragment",
				},
				history: undefined as never,
			},
		});

		await expect(
			environment.router.navigate({
				url: UriReferenceString.parse("https://app.example.com/next"),
				intent: "post_auth_redirect",
				mode: "push",
			}),
		).rejects.toThrow(/requires history/);
	});

	it("omits router when native web router hosts are unavailable", () => {
		const environment = createEnvironmentForNativeWeb({
			transport: createTransport(),
			routerForNativeWebCreateOptions: {
				navigation: null,
				location: null,
				history: null,
				window: null,
			},
		});

		expect(environment.router).toBeUndefined();
	});

	it("omits page lifecycle when native web page targets are unavailable", () => {
		const environment = createEnvironmentForNativeWeb({
			transport: createTransport(),
			routerForNativeWebCreateOptions: {
				location: {
					href: "https://app.example.com/callback#fragment",
					hash: "#fragment",
				},
				history: { replaceState() {} },
			},
			pageLifecycleForNativeWebCreateOptions: {
				document: null,
				window: null,
			},
		});

		expect(environment.pageLifecycle).toBeUndefined();
	});

	it("omits popup when native web popup host is unavailable", () => {
		const environment = createEnvironmentForNativeWeb({
			transport: createTransport(),
			routerForNativeWebCreateOptions: {
				location: {
					href: "https://app.example.com/callback#fragment",
					hash: "#fragment",
				},
				history: { replaceState() {} },
			},
			popupForNativeWebCreateOptions: {
				window: null,
			},
		});

		expect(environment.popup).toBeUndefined();
	});

	it("omits storage when native web storage hosts are unavailable", () => {
		const environment = createEnvironmentForNativeWeb({
			transport: createTransport(),
			routerForNativeWebCreateOptions: {
				location: {
					href: "https://app.example.com/callback#fragment",
					hash: "#fragment",
				},
				history: { replaceState() {} },
			},
			persistentStorageForNativeWebCreateOptions: {
				storage: null,
			},
			sessionStorageForNativeWebCreateOptions: {
				storage: null,
			},
		});

		expect(environment.persistentStorage).toBeUndefined();
		expect(environment.sessionStorage).toBeUndefined();
	});

	it("keeps explicit storage overrides instead of probing native web storage", () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const environment = createEnvironmentForNativeWeb({
			transport: createTransport(),
			persistentStorage,
			sessionStorage,
			routerForNativeWebCreateOptions: {
				location: {
					href: "https://app.example.com/callback#fragment",
					hash: "#fragment",
				},
				history: { replaceState() {} },
			},
			persistentStorageForNativeWebCreateOptions: {
				storage: null,
			},
			sessionStorageForNativeWebCreateOptions: {
				storage: null,
			},
		});

		expect(environment.persistentStorage).toBe(persistentStorage);
		expect(environment.sessionStorage).toBe(sessionStorage);
	});

	it("includes schema issues in environment trait validation errors", () => {
		expect(() =>
			createFoundationEnvironment({
				transport: createTransport(),
				time: createTimeForTest(),
				router: {
					currentUrl() {
						return null;
					},
					baseURI() {
						return null;
					},
				} as never,
			}),
		).toThrow(/navigate.*function/);
	});
});
