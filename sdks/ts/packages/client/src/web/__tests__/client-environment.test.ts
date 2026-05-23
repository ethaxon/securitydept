import { describe, expect, it } from "vitest";
import { createClientEnvironment } from "../../environment/create";
import { createInMemoryRecordStore } from "../../persistence";
import { createEnvironmentForNativeWeb } from "../environment/environment";

function createTransport() {
	return {
		async execute() {
			return { status: 204, headers: {}, body: null };
		},
	};
}

describe("client environment page capability boundary", () => {
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
			location: nativeWebPage.location,
			history: nativeWebPage.history,
		});

		expect(environment.router.currentUrl()?.toString()).toBe(
			nativeWebPage.location.href,
		);
	});

	it("keeps foundation environments page-free", () => {
		const environment = createClientEnvironment({
			transport: createTransport(),
			persistentStorage: createInMemoryRecordStore(),
			sessionStorage: createInMemoryRecordStore(),
		});

		expect("location" in environment).toBe(false);
		expect("history" in environment).toBe(false);
	});

	it("reports missing explicit page capability fields", () => {
		expect(() =>
			createEnvironmentForNativeWeb({
				transport: createTransport(),
				location: {
					href: "https://app.example.com/callback#fragment",
					hash: "#fragment",
				},
				history: undefined as never,
			}),
		).toThrow(/nativeWeb must include location.href/);
	});
});
