import { describe, expect, it, vi } from "vitest";
import { createInMemoryRecordStore } from "../../persistence";
import {
	ClientEnvironmentPreset,
	createBrowserExtensionBackgroundClientEnvironment,
	createBrowserPageClientEnvironment,
	createBrowserWorkerClientEnvironment,
	createServiceWorkerClientEnvironment,
	deriveClientEnvironment,
} from "../client-environment";

function createTransport() {
	return {
		async execute() {
			return { status: 204, headers: {}, body: null };
		},
	};
}

function createClientEnvironmentOptions() {
	return {
		transport: createTransport(),
		persistentStore: createInMemoryRecordStore(),
		sessionStore: createInMemoryRecordStore(),
	};
}

describe("client environment presets", () => {
	it("creates an explicit browser page preset with page capabilities", () => {
		const pageCapability = {
			location: {
				href: "https://app.example.com/dashboard",
				hash: "",
			},
			history: { replaceState() {} },
		};
		const environment = createBrowserPageClientEnvironment({
			...createClientEnvironmentOptions(),
			pageCapability,
		});

		expect(environment.preset).toBe(ClientEnvironmentPreset.BrowserPage);
		expect(environment.location).toBe(pageCapability.location);
		expect(environment.history).toBe(pageCapability.history);
		expect(environment.persistentStore).toBeDefined();
		expect(environment.sessionStore).toBeDefined();
	});

	it("derives client environment from flattened environment fields", () => {
		const environment = createBrowserWorkerClientEnvironment(
			createClientEnvironmentOptions(),
		);
		const canonicalTransport = createTransport();
		const inconsistentEnvironment = {
			...environment,
			transport: canonicalTransport,
		};

		const clientEnvironment = deriveClientEnvironment(inconsistentEnvironment);

		expect(clientEnvironment.transport).toBe(canonicalTransport);
	});

	it("does not infer browser page from worker-like global location", () => {
		vi.stubGlobal("location", {
			href: "https://worker.example.com/background#fragment",
			hash: "#fragment",
		});

		expect(() =>
			createBrowserPageClientEnvironment(createClientEnvironmentOptions()),
		).toThrow(/extension background or service worker hosts/);

		vi.unstubAllGlobals();
	});

	it("keeps worker, service worker, and extension background presets page-free", () => {
		const worker = createBrowserWorkerClientEnvironment(
			createClientEnvironmentOptions(),
		);
		const serviceWorker = createServiceWorkerClientEnvironment(
			createClientEnvironmentOptions(),
		);
		const extensionBackground =
			createBrowserExtensionBackgroundClientEnvironment(
				createClientEnvironmentOptions(),
			);

		expect(worker.preset).toBe(ClientEnvironmentPreset.BrowserWorker);
		expect(serviceWorker.preset).toBe(ClientEnvironmentPreset.ServiceWorker);
		expect(extensionBackground.preset).toBe(
			ClientEnvironmentPreset.BrowserExtensionBackground,
		);
		expect("pageCapability" in worker).toBe(false);
		expect("pageCapability" in serviceWorker).toBe(false);
		expect("pageCapability" in extensionBackground).toBe(false);
	});
});
