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
	type EnvironmentValidators,
	type RouterNavigationRequest,
	type RouterTrait,
	throwValidationClientError,
	UriReferenceString,
	UriString,
	validateTraitInput,
	type WithTraitInputValidator,
} from "@securitydept/client";
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
export interface CreateRouterForAngularOptions {
	/** The Angular `Router` (or a compatible navigation object). */
	router: AngularRouterNavigationLike;
	/**
	 * Override the current URL. Defaults to `router.url`.
	 *
	 * Pass an explicit value when the guarded navigation target differs from
	 * the router's currently active URL.
	 */
	currentUrl?: string | UriReferenceString | null;
	/**
	 * Override the document base URI used to resolve relative references.
	 *
	 * Defaults to `document.baseURI` in browser environments.
	 */
	baseURI?: string | UriString | null;
}

export const AngularRouterNavigationLikeSchema = defineType({
	navigateByUrl: "Function",
});

const CreateRouterForAngularOptionsSchema = defineType({
	router: AngularRouterNavigationLikeSchema,
});

function readBrowserDocumentBaseURI(): UriString | null {
	const global = globalThis as { document?: { baseURI?: string } };
	const baseURI = global.document?.baseURI;
	return baseURI ? UriString.tryParse(baseURI) : null;
}

function resolveConfiguredBaseURI(
	baseURI: string | UriString | null | undefined,
): UriString | null {
	if (baseURI === null) {
		return null;
	}
	if (baseURI === undefined) {
		return null;
	}
	return typeof baseURI === "string" ? UriString.tryParse(baseURI) : baseURI;
}

/**
 * Create a {@link RouterTrait} backed by an Angular `Router`.
 *
 * @example
 * ```ts
 * const routerTrait = createRouterForAngular({ router: inject(Router) });
 * ```
 */
export function createRouterForAngular(
	options: CreateRouterForAngularOptions &
		WithTraitInputValidator<Pick<EnvironmentValidators, "router">>,
): RouterTrait {
	const { validators, ...createOptions } = options;
	const resolvedCreateOptions = createOptions;
	validateTraitInput({
		value: resolvedCreateOptions,
		bundledSchema: CreateRouterForAngularOptionsSchema,
		validator: validators?.router,
		onInvalid: (failure) =>
			throwValidationClientError({
				code: "client_angular.router.invalid_router_options",
				source: "client-angular",
				messagePrefix:
					"createRouterForAngular could not validate routerForAngularCreateOptions",
				failure,
			}),
	});
	const { router, currentUrl, baseURI } = resolvedCreateOptions;
	const configuredBaseURI = Object.hasOwn(options, "baseURI")
		? resolveConfiguredBaseURI(baseURI)
		: undefined;
	return {
		currentUrl() {
			const url = currentUrl ?? router.url;
			return url ? UriReferenceString.tryParse(url.toString()) : null;
		},
		baseURI() {
			return configuredBaseURI ?? readBrowserDocumentBaseURI();
		},
		async navigate(request: RouterNavigationRequest) {
			await router.navigateByUrl(request.url.toString(), {
				replaceUrl: request.mode === "replace",
				state: request.state,
			});
		},
	};
}
