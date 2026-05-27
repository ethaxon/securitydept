import { type as defineType } from "arktype";
import { type EnvironmentValidators } from "../environment/types";
import { type RouterNavigationRequest, type RouterTrait } from "../router";
import {
	throwValidationClientError,
	validateTraitInput,
	validateWithSchemaSync,
	type WithTraitInputValidator,
} from "../validation";

export interface WebExtRouterBrowserLike {
	tabs?: {
		create?(options: { url: string }): unknown;
		update?(tabId: number, options: { url: string }): unknown;
		query?(options: { active?: boolean; currentWindow?: boolean }): unknown;
	};
	windows?: {
		create?(options: { url: string }): unknown;
		getCurrent?(): unknown;
	};
}

export interface RouterForWebExtCreateOptions {
	browser?: WebExtRouterBrowserLike | null;
}

const WebExtTabsRouterLikeSchema = defineType({
	create: "Function",
});

const WebExtWindowsRouterLikeSchema = defineType({
	create: "Function",
});

const RouterForWebExtCreateOptionsSchema = defineType({
	browser: {
		tabs: WebExtTabsRouterLikeSchema.optional(),
		windows: WebExtWindowsRouterLikeSchema.optional(),
	},
});

const RouterForWebExtUnavailableProbeSchema = defineType({
	browser: "null | undefined",
});

export function createRouterForWebExt(
	options: RouterForWebExtCreateOptions &
		WithTraitInputValidator<Pick<EnvironmentValidators, "router">> = {},
): RouterTrait | null {
	const { validators, browser: _browser, ...createOptions } = options;
	const global = globalThis as { browser?: WebExtRouterBrowserLike };
	const resolvedCreateOptions = {
		...createOptions,
		browser: Object.hasOwn(options, "browser")
			? (options.browser ?? null)
			: (global.browser ?? null),
	};
	const unavailableProbeResult = validateWithSchemaSync(
		RouterForWebExtUnavailableProbeSchema,
		resolvedCreateOptions,
	);
	if (
		unavailableProbeResult.success ||
		(!resolvedCreateOptions.browser?.tabs &&
			!resolvedCreateOptions.browser?.windows)
	) {
		return null;
	}
	validateTraitInput({
		value: resolvedCreateOptions,
		bundledSchema: RouterForWebExtCreateOptionsSchema,
		validator: validators?.router,
		onInvalid: (failure) =>
			throwValidationClientError({
				code: "webext.router.invalid_background_router_options",
				source: "webext",
				messagePrefix:
					"createRouterForWebExt could not validate routerForWebExtCreateOptions",
				failure,
			}),
	});
	const browser = resolvedCreateOptions.browser as WebExtRouterBrowserLike;
	const router: RouterTrait = {
		currentUrl() {
			return null;
		},
		async navigate(request: RouterNavigationRequest) {
			const url = request.url.toString();
			if (browser.tabs?.create) {
				await browser.tabs.create({ url });
				return;
			}
			if (browser.windows?.create) {
				await browser.windows.create({ url });
				return;
			}
			throw new Error("Web extension background router cannot open URL.");
		},
	};
	return router;
}
