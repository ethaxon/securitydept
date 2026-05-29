import { type as defineType } from "arktype";
import { SecuritydeptInjectionToken } from "../injection";
import {
	type CompatFragment,
	takeCompatFragment,
} from "../protocol/compat-fragment";
import { type UriReferenceString, type UriString } from "../struct/uri-string";

export interface RouterNavigationRequest {
	url: UriReferenceString;
	intent:
		| "auth_redirect"
		| "post_auth_redirect"
		| "callback_cleanup"
		| "external_open";
	mode: "push" | "replace" | "external";
	state?: unknown;
}

export interface RouterTrait {
	currentUrl(): UriReferenceString | null;
	baseURI(): UriString | null;
	navigate(request: RouterNavigationRequest): void | Promise<void>;
}

export async function takeCompatFragmentFromRouter(
	router: RouterTrait,
): Promise<CompatFragment | null> {
	const currentUrl = router.currentUrl();

	if (!currentUrl) {
		return null;
	}

	const { compatFragment, url: cleanedUrl } = takeCompatFragment(
		currentUrl,
		(ref, hash) => ref.setHash(hash),
	);

	if (!compatFragment) {
		return null;
	}

	await router.navigate({
		url: cleanedUrl,
		intent: "callback_cleanup",
		mode: "replace",
	});
	return compatFragment;
}

export const RouterTraitSchema = defineType({
	currentUrl: "Function",
	baseURI: "Function",
	navigate: "Function",
});

export const ROUTER_TRAIT_TOKEN =
	new SecuritydeptInjectionToken<RouterTrait | null>("ROUTER_TRAIT_TOKEN");
