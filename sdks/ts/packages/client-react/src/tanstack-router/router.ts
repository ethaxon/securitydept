import {
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
import { type AnyRouter, type NavigateOptions } from "@tanstack/react-router";
import { type as defineType } from "arktype";

export interface TanStackRouterLocationLike {
	readonly href: string;
}

export interface TanStackRouterNavigationLike {
	readonly state?: {
		readonly location?: TanStackRouterLocationLike;
	};
	navigate(options: TanStackRouterNavigateOptions): Promise<unknown> | unknown;
}

export type TanStackRouterNavigateOptions = NavigateOptions<
	AnyRouter,
	string,
	string | undefined,
	string,
	""
>;

export interface CreateRouterForTanStackRouterOptions {
	readonly router: TanStackRouterNavigationLike;
	readonly currentUrl?: string | null;
}

export interface ResolvedRouterForTanStackRouterCreateOptions {
	readonly router: TanStackRouterNavigationLike;
	readonly currentUrl: string | null;
}

const TanStackRouterNavigationLikeSchema = defineType({
	state: "object?",
	navigate: "Function",
});

const ResolvedRouterForTanStackRouterCreateOptionsSchema = defineType({
	router: TanStackRouterNavigationLikeSchema,
	currentUrl: UriReferenceStringSchema.or("null"),
});

export function createRouterForTanStackRouter(
	options: CreateRouterForTanStackRouterOptions &
		WithTraitInputValidator<Pick<EnvironmentValidators, "router">>,
): RouterTrait {
	const routerInput = options.router as
		| TanStackRouterNavigationLike
		| null
		| undefined;
	const resolvedCreateOptions: ResolvedRouterForTanStackRouterCreateOptions = {
		router: options.router,
		get currentUrl() {
			if (Object.hasOwn(options, "currentUrl")) {
				return options.currentUrl ?? null;
			}

			return routerInput?.state?.location?.href ?? null;
		},
	};

	validateTraitInput({
		value: resolvedCreateOptions,
		bundledSchema: ResolvedRouterForTanStackRouterCreateOptionsSchema,
		validator: options.validators?.router,
		onInvalid: (failure) =>
			throwValidationClientError({
				code: "client_react.tanstack_router.invalid_router_options",
				source: "client-react",
				messagePrefix:
					"createRouterForTanStackRouter could not validate routerForTanStackRouterCreateOptions",
				failure,
			}),
	});

	const { router } = resolvedCreateOptions;
	return {
		currentUrl() {
			const currentUrl = resolvedCreateOptions.currentUrl;
			return currentUrl == null ? null : UriReferenceString.parse(currentUrl);
		},
		async navigate(request: RouterNavigationRequest) {
			if (request.mode === RouterNavigationMode.External) {
				await router.navigate({ href: request.url.toString() });
				return;
			}
			await router.navigate({
				to: request.url.toString(),
				replace: request.mode === RouterNavigationMode.Replace,
				state: request.state as TanStackRouterNavigateOptions["state"],
			});
		},
	};
}
