import {
	createFoundationEnvironment,
	createInMemoryRecordStore,
	createRootSpan,
	createTracing,
	takeCompatFragmentFromRouter,
} from "@securitydept/client";
import { createRouterForNativeWeb } from "@securitydept/client/web";
import { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import { describe, expect, it, vi } from "vitest";

function callbackParameters(fragment: string): Record<string, string> {
	const parameters = new URLSearchParams(fragment);
	const result: Record<string, string> = {};
	parameters.forEach((value, key) => {
		result[key] = value;
	});
	return result;
}

function createTime() {
	return {
		now: () => Date.parse("2026-01-01T00:00:00Z"),
		setTimeout: (callback: () => void, delayMs: number) =>
			globalThis.setTimeout(callback, delayMs),
		clearTimeout: (handle: unknown) =>
			globalThis.clearTimeout(
				handle as ReturnType<typeof globalThis.setTimeout>,
			),
	};
}

function createMetadataTransport() {
	return {
		async execute() {
			return {
				status: 200,
				headers: {},
				body: {
					metadata: {
						principal: {
							subject: "worker-user",
							displayName: "Worker User",
						},
					},
				},
			};
		},
	};
}

describe("backend-oidc worker-like host boundary", () => {
	it("does not treat globalThis.location as a page callback environment", async () => {
		vi.stubGlobal("location", {
			href: "https://extension.example/background#/background",
			hash: "#/background",
		});

		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const client = new BackendOidcModeClient(
			{ baseUrl: "" },
			createFoundationEnvironment({
				span: createRootSpan(),
				tracing: createTracing(),
				persistentStorage,
				sessionStorage,
				transport: createMetadataTransport(),
				time: createTime(),
			}),
		);

		const result = await client.start();

		expect(result).toBeNull();

		vi.unstubAllGlobals();
	});

	it("restores persisted token state without running page callback capture", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const baseEnvironment = createFoundationEnvironment({
			transport: createMetadataTransport(),
			persistentStorage,
			sessionStorage,
			time: createTime(),
			span: createRootSpan(),
			tracing: createTracing(),
		});
		const callbackClient = new BackendOidcModeClient(
			{ baseUrl: "" },
			baseEnvironment,
		);

		await callbackClient.handleCallback(
			callbackParameters(
				"access_token=worker-at&id_token=worker-idt&refresh_token=worker-rt&metadata_redemption_id=meta-worker",
			),
		);
		const restoreClient = new BackendOidcModeClient(
			{ baseUrl: "" },
			baseEnvironment,
		);
		const result = await restoreClient.start();

		expect(result?.tokens.accessToken).toBe("worker-at");
		expect(
			restoreClient.authResource.value.get()?.metadata.principal?.displayName,
		).toBe("Worker User");
	});

	it("takes callback fragments only from explicit host-injected page capabilities", async () => {
		const time = createTime();
		const client = new BackendOidcModeClient(
			{ baseUrl: "" },
			createFoundationEnvironment({
				transport: createMetadataTransport(),
				time,
				span: createRootSpan(),
				tracing: createTracing(),
			}),
		);
		const history = {
			replacedUrl: "",
			replaceState(_data: unknown, _unused: string, url?: string) {
				this.replacedUrl = url ?? "";
			},
		};

		const fragment = await takeCompatFragmentFromRouter(
			createRouterForNativeWeb({
				location: {
					href: "https://app.example.com/popup#securitydept=v1&access_token=popup-at&id_token=popup-idt&metadata_redemption_id=meta-worker",
					hash: "#securitydept=v1&access_token=popup-at&id_token=popup-idt&metadata_redemption_id=meta-worker",
				},
				history,
			})!,
		);
		const snapshot = await client.handleCallback(fragment?.parameters ?? {});

		expect(fragment?.payload).toBe(
			"access_token=popup-at&id_token=popup-idt&metadata_redemption_id=meta-worker",
		);
		expect(snapshot.tokens.accessToken).toBe("popup-at");
		expect(history.replacedUrl).toBe("https://app.example.com/popup");
	});
});
