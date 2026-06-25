// Angular Router trait adapter
//
// Canonical import path:
//   import { createRouterForAngular } from "@securitydept/client-angular"
//
// Projects an Angular `Router` (or any navigation-capable object) onto the
// framework-agnostic `RouterTrait` (currentUrl + navigate) from
// `@securitydept/client`. Adopters use this to give SDK primitives a way to
// read the current URL and start navigations without depending on Angular.
//
// Architecture boundary:
//   - Does NOT own the Angular router, guards, or navigation lifecycle.
//   - Does NOT read auth requirements or run planners (see route-guard.ts).
//   - Does NOT carry token-set-specific mapping or policy.
//
// Stability: provisional

import {
	ClientError,
	ClientErrorKind,
	type EnvironmentValidators,
	RouterNavigationMode,
	type RouterNavigationRequest,
	type RouterTrait,
	throwValidationClientError,
	UriReferenceString,
	UriReferenceStringSchema,
	validateTraitInput,
	type WithTraitInputValidator,
} from "@securitydept/client";
import {
	createRouterForNativeWeb,
	type RouterForNativeWebCreateOptions,
} from "@securitydept/client/web";
import { type as defineType } from "arktype";

/**
 * Minimal navigation surface required from an Angular `Router`.
 *
 * The real `@angular/router` `Router` satisfies this shape, so adopters pass
 * their injected `Router` directly.
 */
export interface AngularRouterNavigationLike {
	url?: string;
	navigateByUrl(
		url: string,
		options?: { replaceUrl?: boolean; state?: unknown },
	): Promise<boolean> | boolean;
}

/** Options for {@link createRouterForAngular}. */
export interface CreateRouterForAngularOptions
	extends RouterForNativeWebCreateOptions {
	/** The Angular `Router` (or a compatible navigation object). */
	router: AngularRouterNavigationLike;
	/** Override the current URL. Defaults to `router.url`. */
	currentUrl?: string | null;
}

export interface ResolvedRouterForAngularCreateOptions {
	router: AngularRouterNavigationLike;
	currentUrl: string | null;
}

export const AngularRouterNavigationLikeSchema = defineType({
	url: "string?",
	navigateByUrl: "Function",
});

const ResolvedRouterForAngularCreateOptionsSchema = defineType({
	router: AngularRouterNavigationLikeSchema,
	currentUrl: UriReferenceStringSchema.or("null"),
});

/**
 * Create a {@link RouterTrait} backed by an Angular `Router`.
 *
 * @example
 * ```ts
 * const routerTrait = createRouterForAngular({
 *   router: inject(Router),
 *   location: window.location,
 * });
 * ```
 */
export function createRouterForAngular(
	options: CreateRouterForAngularOptions &
		WithTraitInputValidator<Pick<EnvironmentValidators, "router">>,
): RouterTrait {
	const routerInput = options.router as
		| AngularRouterNavigationLike
		| null
		| undefined;
	const resolvedCreateOptions: ResolvedRouterForAngularCreateOptions = {
		router: options.router,
		get currentUrl() {
			return Object.hasOwn(options, "currentUrl")
				? (options.currentUrl ?? null)
				: (routerInput?.url ?? null);
		},
	};
	validateTraitInput({
		value: resolvedCreateOptions,
		bundledSchema: ResolvedRouterForAngularCreateOptionsSchema,
		validator: options.validators?.router,
		onInvalid: (failure) =>
			throwValidationClientError({
				code: "client_angular.router.invalid_router_options",
				source: "client-angular",
				messagePrefix:
					"createRouterForAngular could not validate routerForAngularCreateOptions",
				failure,
			}),
	});
	const { router } = resolvedCreateOptions;
	const nativeWebRouter = createRouterForNativeWeb(
		projectNativeWebRouterCreateOptions(options),
	);
	return {
		currentUrl() {
			const currentUrl = resolvedCreateOptions.currentUrl;
			return currentUrl == null ? null : UriReferenceString.parse(currentUrl);
		},
		async navigate(request: RouterNavigationRequest) {
			if (request.mode === RouterNavigationMode.External) {
				if (!nativeWebRouter) {
					throw new ClientError({
						kind: ClientErrorKind.Configuration,
						code: "client_angular.router.native_web_router_unavailable",
						message:
							"Angular router cannot perform external navigation without a native web router",
						source: "client-angular.router",
					});
				}
				await nativeWebRouter.navigate(request);
				return;
			}
			await router.navigateByUrl(request.url.toString(), {
				replaceUrl: request.mode === RouterNavigationMode.Replace,
				state: request.state,
			});
		},
	};
}

function projectNativeWebRouterCreateOptions(
	options: CreateRouterForAngularOptions,
): RouterForNativeWebCreateOptions {
	return {
		...(Object.hasOwn(options, "navigation")
			? { navigation: options.navigation }
			: {}),
		...(Object.hasOwn(options, "location")
			? { location: options.location }
			: {}),
		...(Object.hasOwn(options, "history") ? { history: options.history } : {}),
		...(Object.hasOwn(options, "window") ? { window: options.window } : {}),
	};
}
