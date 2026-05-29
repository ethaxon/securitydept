import { describe, expect, it, vi } from "vitest";
import { RouterGuardDecisionKind, RouterGuardPhase } from "../../router";
import { UriReferenceString } from "../../struct/uri-string";
import {
	createGuardedRouterForNativeWeb,
	createRouterForNativeWeb,
	type NativeWebNavigateEventLike,
} from "../router";

describe("native web router adapter", () => {
	it("creates a legacy router for location/history hosts", async () => {
		const replaceState = vi.fn();
		const pushState = vi.fn();
		const router = createRouterForNativeWeb({
			location: { href: "https://app.example.com/" },
			history: { replaceState, pushState },
		});

		await router.navigate({
			url: UriReferenceString.parse("/dashboard"),
			intent: "post_auth_redirect",
			mode: "push",
		});

		expect(pushState).toHaveBeenCalledWith(null, "", "/dashboard");
	});

	it("guards managed legacy navigate requests", async () => {
		const replaceState = vi.fn();
		const beforeLoad = vi.fn(
			() =>
				({
					kind: RouterGuardDecisionKind.Redirect,
					url: UriReferenceString.parse("/login"),
					mode: "replace",
				}) as const,
		);
		const router = createGuardedRouterForNativeWeb({
			location: { href: "https://app.example.com/" },
			history: { replaceState },
			beforeLoad,
		});

		await router.navigate({
			url: UriReferenceString.parse("/dashboard"),
			intent: "post_auth_redirect",
			mode: "push",
		});

		expect(beforeLoad).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: RouterGuardPhase.Navigate,
				url: UriReferenceString.parse("/dashboard"),
			}),
		);
		expect(replaceState).toHaveBeenCalledWith(null, "", "/login");
	});

	it("uses Navigation API navigate events for host-level guarded navigation", async () => {
		let navigateHandler:
			| ((event: NativeWebNavigateEventLike) => void)
			| undefined;
		let interceptedHandler: (() => Promise<void> | void) | undefined;
		const controller = new AbortController();
		const beforeLoad = vi.fn(() => ({ kind: RouterGuardDecisionKind.Block }));
		const router = createGuardedRouterForNativeWeb({
			location: { href: "https://app.example.com/" },
			navigation: {
				navigate: vi.fn(),
				addEventListener(_type, handler) {
					navigateHandler = handler;
				},
				removeEventListener(_type, handler) {
					if (navigateHandler === handler) {
						navigateHandler = undefined;
					}
				},
			},
			beforeLoad,
		});

		navigateHandler?.({
			canIntercept: true,
			destination: { url: "https://app.example.com/protected" },
			navigationType: "push",
			signal: controller.signal,
			intercept(options) {
				interceptedHandler = options?.handler;
			},
		});

		await expect(interceptedHandler?.()).rejects.toThrow(/blocked/);
		expect(beforeLoad).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: RouterGuardPhase.Navigate,
				cancellationToken: expect.objectContaining({
					isCancellationRequested: false,
				}),
				url: UriReferenceString.parse("https://app.example.com/protected"),
			}),
		);

		router.dispose();
		expect(navigateHandler).toBeUndefined();
	});
});
