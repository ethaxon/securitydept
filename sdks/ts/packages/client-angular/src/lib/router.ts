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
	BaseURIStringSchema,
	type EnvironmentValidators,
	RouterNavigationMode,
	type RouterNavigationRequest,
	type RouterTrait,
	throwValidationClientError,
	UriReferenceString,
	UriReferenceStringSchema,
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

export interface AngularDocumentLike {
	baseURI?: string;
}

/** Options for {@link createRouterForAngular}. */
export interface CreateRouterForAngularOptions {
	/** The Angular `Router` (or a compatible navigation object). */
	router: AngularRouterNavigationLike;
	/** Override the current URL. Defaults to `router.url`. */
	currentUrl?: string | null;
	/** Angular document host used to resolve the default base URI. */
	document?: AngularDocumentLike | null;
	/**
	 * Override the document base URI used to resolve relative references.
	 *
	 * Defaults to the explicitly provided Angular document's `baseURI`.
	 */
	baseURI?: string | null;
}

export interface ResolvedRouterForAngularCreateOptions {
	router: AngularRouterNavigationLike;
	currentUrl: string | null;
	baseURI: string | null;
}

export const AngularRouterNavigationLikeSchema = defineType({
	url: "string?",
	navigateByUrl: "Function",
});

const ResolvedRouterForAngularCreateOptionsSchema = defineType({
	router: AngularRouterNavigationLikeSchema,
	currentUrl: UriReferenceStringSchema.or("null"),
	baseURI: BaseURIStringSchema.or("null"),
});

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
		get baseURI() {
			return Object.hasOwn(options, "baseURI")
				? (options.baseURI ?? null)
				: (options.document?.baseURI ?? null);
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
	return {
		currentUrl() {
			const currentUrl = resolvedCreateOptions.currentUrl;
			return currentUrl == null ? null : UriReferenceString.parse(currentUrl);
		},
		baseURI() {
			const baseURI = resolvedCreateOptions.baseURI;
			return baseURI == null ? null : UriString.parse(baseURI);
		},
		async navigate(request: RouterNavigationRequest) {
			await router.navigateByUrl(request.url.toString(), {
				replaceUrl: request.mode === RouterNavigationMode.Replace,
				state: request.state,
			});
		},
	};
}
