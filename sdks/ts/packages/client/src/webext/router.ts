import { type as defineType } from "arktype";
import { type EnvironmentValidators } from "../environment/types";
import { ClientError, ClientErrorKind } from "../errors";
import { type RouterNavigationRequest, type RouterTrait } from "../router";
import { type UriReferenceString } from "../struct/uri-string";
import {
	throwValidationClientError,
	validateTraitInput,
	validateWithSchemaSync,
	type WithTraitInputValidator,
} from "../validation";

export interface WebExtRouterBrowserLike {
	runtime?: {
		getURL(path: string): string;
	};
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

const WebExtRuntimeRouterLikeSchema = defineType({
	getURL: "Function",
});

const WebExtTabsRouterLikeSchema = defineType({
	create: "Function",
});

const WebExtWindowsRouterLikeSchema = defineType({
	create: "Function",
});

const RouterForWebExtCreateOptionsSchema = defineType({
	browser: {
		runtime: WebExtRuntimeRouterLikeSchema.optional(),
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
	const { validators, ...createOptions } = options;
	const global = globalThis as { browser?: WebExtRouterBrowserLike };
	const browser = Object.hasOwn(options, "browser")
		? (options.browser ?? null)
		: (global.browser ?? null);
	const resolvedCreateOptions = {
		...createOptions,
		browser,
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
	const resolvedBrowser =
		resolvedCreateOptions.browser as WebExtRouterBrowserLike;

	const router: RouterTrait = {
		currentUrl(): UriReferenceString | null {
			return null;
		},
		async navigate(request: RouterNavigationRequest) {
			const url = request.url.toString();
			if (resolvedBrowser.tabs?.create) {
				await resolvedBrowser.tabs.create({ url });
				return;
			}
			if (resolvedBrowser.windows?.create) {
				await resolvedBrowser.windows.create({ url });
				return;
			}
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				code: "webext.router.navigation_unavailable",
				message: "Web extension router cannot open the requested URL",
				source: "webext.router",
			});
		},
	};
	return router;
}
