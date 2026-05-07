import { describe, expect, it, vi } from "vitest";
import { createInMemoryRecordStore } from "../../persistence";
import {
	createWebClientEnvironment,
	readDefaultPageLocationHistoryCapability,
	requireDefaultPageLocationHistoryCapability,
	requirePageClientEnvironment,
} from "../client-environment";

function createTransport() {
	return {
		async execute() {
			return { status: 204, headers: {}, body: null };
		},
	};
}

describe("client environment page resolver", () => {
	it("does not treat a global location without window history as a page", () => {
		vi.stubGlobal("location", {
			href: "https://worker.example.com/callback#fragment",
			hash: "#fragment",
		});

		expect(readDefaultPageLocationHistoryCapability()).toBeNull();
		expect(() => requireDefaultPageLocationHistoryCapability()).toThrow(
			/extension background or service worker hosts/,
		);

		vi.unstubAllGlobals();
	});

	it("accepts explicit fake page capabilities", () => {
		const pageCapability = {
			location: {
				href: "https://app.example.com/callback#fragment",
				hash: "#fragment",
			},
			history: { replaceState() {} },
		};
		const environment = createWebClientEnvironment({
			transport: createTransport(),
			persistentStore: createInMemoryRecordStore(),
			sessionStore: createInMemoryRecordStore(),
		});

		expect(
			requirePageClientEnvironment({
				environment,
				pageCapability,
			}).location,
		).toBe(pageCapability.location);
		expect(
			requirePageClientEnvironment({
				environment,
				pageCapability,
			}).history,
		).toBe(pageCapability.history);
	});

	it("fails without explicit environment and does not read global window", () => {
		const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			"window",
		);
		let windowRead = false;

		Object.defineProperty(globalThis, "window", {
			configurable: true,
			get() {
				windowRead = true;
				return {
					location: {
						href: "https://app.example.com/callback#fragment",
						hash: "#fragment",
					},
					history: { replaceState() {} },
				};
			},
		});

		try {
			expect(() => requirePageClientEnvironment()).toThrow(
				/createBrowserPageClientEnvironment/,
			);
			expect(windowRead).toBe(false);
		} finally {
			if (originalWindowDescriptor) {
				Object.defineProperty(globalThis, "window", originalWindowDescriptor);
			} else {
				Reflect.deleteProperty(globalThis, "window");
			}
		}
	});

	it("reports missing explicit page capability fields", () => {
		const environment = createWebClientEnvironment({
			transport: createTransport(),
		});

		expect(() =>
			requirePageClientEnvironment({
				environment,
				pageCapability: {
					location: {
						href: "https://app.example.com/callback#fragment",
						hash: "#fragment",
					},
				} as never,
			}),
		).toThrow(/pageCapability must include location.href/);
	});

	it("reports missing page location and history on explicit environments", () => {
		const environment = createWebClientEnvironment({
			transport: createTransport(),
		});

		expect(() =>
			requirePageClientEnvironment({
				environment,
			}),
		).toThrow(/explicit page environment with location and history/);
	});
});
