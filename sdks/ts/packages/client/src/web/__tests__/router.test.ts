import { describe, expect, it, vi } from "vitest";
import { UriReferenceString } from "../../struct/uri-string";
import { createRouterForNativeWeb } from "../router";

describe("native web router adapter", () => {
	it("returns null when native web router hosts are unavailable", () => {
		expect(
			createRouterForNativeWeb({
				navigation: null,
				location: null,
				history: null,
				window: null,
			}),
		).toBeNull();
	});

	it("creates a legacy router for location/history hosts", async () => {
		const replaceState = vi.fn();
		const pushState = vi.fn();
		const router = createRouterForNativeWeb({
			location: { href: "https://app.example.com/" },
			history: { replaceState, pushState },
		});
		expect(router).not.toBeNull();
		if (!router) {
			throw new Error("Expected native web router to be available.");
		}

		await router.navigate({
			url: UriReferenceString.parse("/dashboard"),
			intent: "post_auth_redirect",
			mode: "push",
		});

		expect(pushState).toHaveBeenCalledWith(null, "", "/dashboard");
	});
});
