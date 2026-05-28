import { type as defineType } from "arktype";
import { SecuritydeptInjectionToken } from "../injection";
import {
	type CompatFragment,
	parseCompatFragment,
	removeCompatFragment,
} from "../protocol/compat-fragment";

export interface RouterNavigationRequest {
	url: string | URL;
	intent:
		| "auth_redirect"
		| "post_auth_redirect"
		| "callback_cleanup"
		| "external_open";
	mode: "push" | "replace" | "external";
	state?: unknown;
}

export interface RouterTrait {
	currentUrl(): URL | null;
	navigate(request: RouterNavigationRequest): void | Promise<void>;
}

export async function takeCompatFragmentFromRouter(
	router: RouterTrait,
): Promise<CompatFragment | null> {
	const currentUrl = router.currentUrl();

	if (!currentUrl) {
		return null;
	}

	const compatFragment = parseCompatFragment(currentUrl);

	if (!compatFragment) {
		return null;
	}

	const nextUrl = new URL(currentUrl);
	removeCompatFragment(nextUrl);
	await router.navigate({
		url: nextUrl,
		intent: "callback_cleanup",
		mode: "replace",
	});
	return compatFragment;
}

export const RouterTraitSchema = defineType({
	currentUrl: "Function",
	navigate: "Function",
});

export const ROUTER_TRAIT_TOKEN =
	new SecuritydeptInjectionToken<RouterTrait | null>("ROUTER_TRAIT_TOKEN");
