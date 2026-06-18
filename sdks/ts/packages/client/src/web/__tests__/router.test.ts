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

	it("clears a same-document hash via History API instead of Navigation API", async () => {
		const navigate = vi.fn(() => ({
			committed: Promise.resolve(),
		}));
		const location = {
			href: "https://app.example.com/#securitydept=v1&kind=token_set_backend_oidc_callback&access_token=at",
		};
		const replaceState = vi.fn(
			(_state: unknown, _unused: string, url?: string | URL | null) => {
				location.href = String(url);
			},
		);
		const router = createRouterForNativeWeb({
			navigation: { navigate },
			location,
			history: { replaceState, pushState: vi.fn() },
		});
		expect(router).not.toBeNull();
		if (!router) {
			throw new Error("Expected native web router to be available.");
		}

		await router.navigate({
			url: UriReferenceString.parse("https://app.example.com/"),
			intent: "callback_cleanup",
			mode: "replace",
		});

		expect(replaceState).toHaveBeenCalledWith(
			null,
			"",
			"https://app.example.com/",
		);
		expect(navigate).not.toHaveBeenCalled();
		expect(location.href).toBe("https://app.example.com/");
	});

	it("clears same-path callback query via History API instead of Navigation API", async () => {
		const navigate = vi.fn(() => ({
			committed: Promise.resolve(),
		}));
		const location = {
			href: "https://app.example.com/auth/token-set/frontend-mode/callback?code=abc&state=xyz",
		};
		const replaceState = vi.fn(
			(_state: unknown, _unused: string, url?: string | URL | null) => {
				location.href = String(url);
			},
		);
		const router = createRouterForNativeWeb({
			navigation: { navigate },
			location,
			history: { replaceState, pushState: vi.fn() },
		});
		expect(router).not.toBeNull();
		if (!router) {
			throw new Error("Expected native web router to be available.");
		}

		await router.navigate({
			url: UriReferenceString.parse(
				"https://app.example.com/auth/token-set/frontend-mode/callback",
			),
			intent: "callback_cleanup",
			mode: "replace",
		});

		expect(replaceState).toHaveBeenCalledWith(
			null,
			"",
			"https://app.example.com/auth/token-set/frontend-mode/callback",
		);
		expect(navigate).not.toHaveBeenCalled();
	});

	it("uses History API for same-origin path changes", async () => {
		const navigate = vi.fn(() => ({
			committed: Promise.resolve(),
		}));
		const replaceState = vi.fn();
		const router = createRouterForNativeWeb({
			navigation: { navigate },
			location: { href: "https://app.example.com/login" },
			history: { replaceState, pushState: vi.fn() },
		});
		expect(router).not.toBeNull();
		if (!router) {
			throw new Error("Expected native web router to be available.");
		}

		await router.navigate({
			url: UriReferenceString.parse("https://app.example.com/dashboard"),
			intent: "post_auth_redirect",
			mode: "replace",
		});

		expect(replaceState).toHaveBeenCalledWith(
			null,
			"",
			"https://app.example.com/dashboard",
		);
		expect(navigate).not.toHaveBeenCalled();
	});

	it("still uses Navigation API for cross-origin navigations", async () => {
		const navigate = vi.fn(() => ({
			committed: Promise.resolve(),
		}));
		const replaceState = vi.fn();
		const router = createRouterForNativeWeb({
			navigation: { navigate },
			location: { href: "https://app.example.com/login" },
			history: { replaceState, pushState: vi.fn() },
		});
		expect(router).not.toBeNull();
		if (!router) {
			throw new Error("Expected native web router to be available.");
		}

		await router.navigate({
			url: UriReferenceString.parse("https://other.example.com/dashboard"),
			intent: "post_auth_redirect",
			mode: "replace",
		});

		expect(navigate).toHaveBeenCalledWith(
			"https://other.example.com/dashboard",
			{
				history: "replace",
				state: undefined,
			},
		);
		expect(replaceState).not.toHaveBeenCalled();
	});
});
