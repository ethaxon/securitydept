import { type as defineType } from "arktype";
import { type EnvironmentValidators } from "../../environment/types";
import { type RouterNavigationRequest, type RouterTrait } from "../../router";
import {
	throwValidationClientError,
	validateTraitInput,
	type WithTraitInputValidator,
} from "../../validation";

export interface NativeWebNavigateEventLike {
	readonly destination?: {
		readonly url: string;
		getState?(): unknown;
	};
	readonly navigationType?: "push" | "replace" | "reload" | "traverse";
	readonly canIntercept?: boolean;
	readonly signal?: AbortSignal;
	intercept(options?: { handler?: () => Promise<void> | void }): void;
	redirect?(url: string, options?: { history?: "push" | "replace" }): void;
}

export interface NativeWebNavigationLike {
	navigate(
		url: string,
		options?: { history?: "push" | "replace"; state?: unknown },
	): { committed?: Promise<unknown>; finished?: Promise<unknown> } | void;
	addEventListener?(
		type: "navigate",
		handler: (event: NativeWebNavigateEventLike) => void,
	): void;
	removeEventListener?(
		type: "navigate",
		handler: (event: NativeWebNavigateEventLike) => void,
	): void;
}

export interface NativeWebLocationLike {
	href: string;
	hash?: string;
	pathname?: string;
	search?: string;
	origin?: string;
}

export interface NativeWebHistoryLike {
	pushState?(data: unknown, unused: string, url?: string | URL | null): void;
	replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

export interface NativeWebWindowLike {
	location?: NativeWebLocationLike;
	history?: NativeWebHistoryLike;
	open?(url?: string | URL, target?: string, features?: string): unknown;
}

export interface RouterForNativeWebCreateOptions {
	navigation?: NativeWebNavigationLike | null;
	location?: NativeWebLocationLike | null;
	history?: NativeWebHistoryLike | null;
	window?: NativeWebWindowLike | null;
}

export interface ResolvedRouterForNativeWebCreateOptions {
	navigation: NativeWebNavigationLike | null;
	location: NativeWebLocationLike | null;
	history: NativeWebHistoryLike | null;
	window: NativeWebWindowLike | null;
}

const NativeWebNavigationLikeSchema = defineType({
	navigate: "Function",
	addEventListener: "Function?",
	removeEventListener: "Function?",
});

const NativeWebLocationLikeSchema = defineType({
	href: "string",
});

const NativeWebHistoryLikeSchema = defineType({
	replaceState: "Function",
});

const NativeWebWindowLikeSchema = defineType({
	location: NativeWebLocationLikeSchema.optional(),
	history: NativeWebHistoryLikeSchema.optional(),
	open: "Function?",
});

const NullableNativeWebHistoryLikeSchema =
	NativeWebHistoryLikeSchema.or("null").or("undefined");
const NullableNativeWebWindowLikeSchema =
	NativeWebWindowLikeSchema.or("null").or("undefined");

const RouterForNativeWebCreateOptionsSchema = defineType({
	navigation: NativeWebNavigationLikeSchema,
	location: NativeWebLocationLikeSchema.or("null").or("undefined"),
	history: NullableNativeWebHistoryLikeSchema,
	window: NullableNativeWebWindowLikeSchema,
}).or({
	navigation: "null | undefined",
	location: NativeWebLocationLikeSchema,
	history: NullableNativeWebHistoryLikeSchema,
	window: NullableNativeWebWindowLikeSchema,
});

export function createRouterForNativeWeb(
	options: RouterForNativeWebCreateOptions &
		WithTraitInputValidator<Pick<EnvironmentValidators, "router">> = {},
): RouterTrait {
	const router = new NativeWebRouter(
		resolveRouterForNativeWebCreateOptions(options),
	);
	return {
		currentUrl() {
			return router.currentUrl();
		},
		navigate(request) {
			return router.navigate(request);
		},
	};
}

export class NativeWebRouter implements RouterTrait {
	protected readonly router: WebNavigationRouter | WebLegacyRouter;

	constructor(options: ResolvedRouterForNativeWebCreateOptions) {
		this.router = options.navigation
			? new WebNavigationRouter(options)
			: new WebLegacyRouter(options);
	}

	currentUrl(): URL | null {
		return this.router.currentUrl();
	}

	navigate(request: RouterNavigationRequest): void | Promise<void> {
		return this.router.navigate(request);
	}
}

export class WebNavigationRouter implements RouterTrait {
	protected readonly navigation: NativeWebNavigationLike;
	protected readonly location: NativeWebLocationLike | null;

	constructor(options: ResolvedRouterForNativeWebCreateOptions) {
		if (!options.navigation) {
			throw new Error("WebNavigationRouter requires navigation.");
		}
		this.navigation = options.navigation;
		this.location = options.location;
	}

	currentUrl(): URL | null {
		return this.location?.href ? new URL(this.location.href) : null;
	}

	async navigate(request: RouterNavigationRequest): Promise<void> {
		const target = new URL(
			request.url.toString(),
			this.currentUrl() ?? undefined,
		).toString();
		if (request.mode === "external") {
			if (this.location) {
				this.location.href = target;
				return;
			}
			throw new Error("Native web router cannot perform external navigation.");
		}
		const result = this.navigation.navigate(target, {
			history: request.mode === "replace" ? "replace" : "push",
			state: request.state,
		});
		await result?.committed;
	}
}

export class WebLegacyRouter implements RouterTrait {
	protected readonly location: NativeWebLocationLike | null;
	protected readonly history: NativeWebHistoryLike | null;

	constructor(options: ResolvedRouterForNativeWebCreateOptions) {
		this.location = options.location;
		this.history = options.history;
	}

	currentUrl(): URL | null {
		return this.location?.href ? new URL(this.location.href) : null;
	}

	async navigate(request: RouterNavigationRequest): Promise<void> {
		const currentUrl = this.currentUrl();
		const targetUrl = new URL(request.url.toString(), currentUrl ?? undefined);
		const target = targetUrl.toString();
		if (request.mode === "external") {
			if (this.location) {
				this.location.href = target;
				return;
			}
			throw new Error("Native web router cannot perform external navigation.");
		}
		if (!this.history) {
			throw new Error(
				"Native web router requires history for in-page navigation.",
			);
		}
		if (request.mode === "replace" || !this.history.pushState) {
			this.history.replaceState(request.state ?? null, "", target);
		} else {
			this.history.pushState(request.state ?? null, "", target);
		}
	}
}

export function resolveRouterForNativeWebCreateOptions(
	options: RouterForNativeWebCreateOptions &
		WithTraitInputValidator<Pick<EnvironmentValidators, "router">> = {},
): ResolvedRouterForNativeWebCreateOptions {
	const { validators, ...createOptions } = options;
	const global = globalThis as {
		navigation?: NativeWebNavigationLike;
		location?: NativeWebLocationLike;
		history?: NativeWebHistoryLike;
		window?: NativeWebWindowLike;
	};
	const windowLike = Object.hasOwn(options, "window")
		? (options.window ?? null)
		: (global.window ?? null);
	const navigation = Object.hasOwn(options, "navigation")
		? (options.navigation ?? null)
		: (global.navigation ?? null);
	const location = Object.hasOwn(options, "location")
		? (options.location ?? null)
		: (windowLike?.location ?? global.location ?? null);
	const history = Object.hasOwn(options, "history")
		? (options.history ?? null)
		: (windowLike?.history ?? global.history ?? null);
	const resolvedCreateOptions = {
		...createOptions,
		window: windowLike,
		navigation,
		location,
		history,
	};
	validateTraitInput({
		value: resolvedCreateOptions,
		bundledSchema: RouterForNativeWebCreateOptionsSchema,
		validator: validators?.router,
		onInvalid: (failure) =>
			throwValidationClientError({
				code: "web.router.invalid_native_web_router_options",
				source: "web",
				messagePrefix:
					"createRouterForNativeWeb could not validate routerForNativeWebCreateOptions",
				failure,
			}),
	});
	return resolvedCreateOptions;
}
