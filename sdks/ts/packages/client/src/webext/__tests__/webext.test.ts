import { describe, expect, it, vi } from "vitest";
import {
	createEnvironmentForWebExtBackgroundScript,
	createEnvironmentForWebExtCore,
	createEnvironmentForWebExtUI,
	createPersistentStorageForWebExt,
	createRouterForWebExt,
	type WebExtRouterBrowserLike,
	type WebExtStorageAreaLike,
	type WebExtStorageBrowserLike,
} from "../index";

function createTransport() {
	return {
		async execute() {
			return { status: 204, headers: {}, body: null };
		},
	};
}

describe("web extension environment adapters", () => {
	it("adapts background-script browser tabs into a router trait", async () => {
		const create = vi.fn();
		const browser: WebExtRouterBrowserLike = {
			tabs: {
				create,
			},
		};

		const router = createRouterForWebExt({ browser });

		expect(router).not.toBeNull();
		if (!router) {
			return;
		}
		expect(router.currentUrl()).toBeNull();
		await router.navigate({
			url: "https://example.com/login",
			mode: "external",
			intent: "auth_redirect",
		});
		expect(create).toHaveBeenCalledWith({
			url: "https://example.com/login",
		});
	});

	it("returns null when extension router host is unavailable", () => {
		expect(
			createRouterForWebExt({
				browser: null,
			}),
		).toBeNull();
	});

	it("rejects malformed extension router host shapes", () => {
		expect(() =>
			createRouterForWebExt({
				browser: {
					tabs: {},
				},
			}),
		).toThrow(/routerForWebExtCreateOptions/u);
	});

	it("adapts extension storage areas into storage traits", async () => {
		const data = new Map<string, string>();
		const storageArea: WebExtStorageAreaLike = {
			get(key) {
				return { [key]: data.get(key) };
			},
			set(entries) {
				for (const [key, value] of Object.entries(entries)) {
					if (typeof value === "string") {
						data.set(key, value);
					}
				}
			},
			remove(key) {
				data.delete(key);
			},
		};

		const storage = createPersistentStorageForWebExt({
			storageArea,
			prefix: "test:",
		});

		expect(storage).not.toBeNull();
		if (!storage) {
			return;
		}
		await storage.set("token", "abc");
		expect(data.get("test:token")).toBe("abc");
		expect(await storage.take?.("token")).toBe("abc");
		expect(data.has("test:token")).toBe(false);
		await storage.set("token", "def");
		await storage.remove("token");
		expect(await storage.get("token")).toBeNull();
	});

	it("returns null when extension storage is unavailable", () => {
		expect(
			createPersistentStorageForWebExt({
				storageArea: null,
			}),
		).toBeNull();
	});

	it("rejects malformed extension storage host shapes", () => {
		expect(() =>
			createPersistentStorageForWebExt({
				storageArea: {
					get: () => ({}),
					set: () => {},
				} as unknown as WebExtStorageAreaLike,
			}),
		).toThrow(/persistentStorageForWebExtCreateOptions/u);
	});

	it("composes a background-script client environment from explicit host inputs", () => {
		const browser: WebExtRouterBrowserLike & WebExtStorageBrowserLike = {
			tabs: { create: vi.fn() },
			storage: {
				local: {
					get: () => ({}),
					set: () => {},
					remove: () => {},
				},
			},
		};

		const environment = createEnvironmentForWebExtCore({
			routerForWebExtCreateOptions: { browser },
			persistentStorageForWebExtCreateOptions: { browser },
			transport: createTransport(),
		});

		expect(environment.router).toBeDefined();
		expect(environment.persistentStorage).toBeDefined();
		expect(environment.transport).toBeDefined();
	});

	it("keeps the background-script environment as a core environment forwarder", () => {
		const environment = createEnvironmentForWebExtBackgroundScript({
			transport: createTransport(),
		});

		expect(environment.transport).toBeDefined();
		expect(environment.time).toBeDefined();
	});

	it("adds native web page lifecycle for extension UI pages", () => {
		const target = new EventTarget();
		const document = {
			addEventListener: target.addEventListener.bind(target),
			removeEventListener: target.removeEventListener.bind(target),
			visibilityState: "visible" as const,
		};
		const window = {
			addEventListener: target.addEventListener.bind(target),
			removeEventListener: target.removeEventListener.bind(target),
		};

		const environment = createEnvironmentForWebExtUI({
			pageLifecycleForNativeWebCreateOptions: {
				document,
				window,
			},
			transport: createTransport(),
		});

		expect(environment.pageLifecycle).toBeDefined();
	});
});
