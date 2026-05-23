import { describe, expect, it, vi } from "vitest";
import {
	createEnvironmentForWebExtBackgroundScript,
	createRouterForWebExtBackgroundScript,
	createStorageForWebExt,
	type WebExtBrowserLike,
	type WebExtStorageAreaLike,
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
		const browser: WebExtBrowserLike = {
			tabs: {
				create,
			},
		};

		const router = createRouterForWebExtBackgroundScript({ browser });

		expect(router.currentUrl()).toBeNull();
		expect(
			router.canNavigate({
				url: "https://example.com",
				mode: "external",
				intent: "external_open",
			}),
		).toBe(true);
		await router.navigate({
			url: "https://example.com/login",
			mode: "external",
			intent: "auth_redirect",
		});
		expect(create).toHaveBeenCalledWith({
			url: "https://example.com/login",
		});
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

		const storage = createStorageForWebExt({ storageArea });

		await storage.set("token", "abc");
		expect(await storage.get("token")).toBe("abc");
		await storage.remove("token");
		expect(await storage.get("token")).toBeNull();
	});

	it("composes a background-script client environment from explicit host inputs", () => {
		const browser: WebExtBrowserLike = {
			tabs: { create: vi.fn() },
			storage: {
				local: {
					get: () => ({}),
					set: () => {},
					remove: () => {},
				},
			},
		};

		const environment = createEnvironmentForWebExtBackgroundScript({
			browser,
			transport: createTransport(),
		});

		expect(environment.router).toBeDefined();
		expect(environment.persistentStorage).toBeDefined();
		expect(environment.transport).toBeDefined();
	});
});
