import { type as defineType } from "arktype";
import { SecuritydeptInjectionToken } from "../injection";
import {
	type CompatFragment,
	takeCompatFragment,
} from "../protocol/compat-fragment";
import { type UriReferenceString, type UriString } from "../struct/uri-string";

export const RouterNavigationIntent = {
	AuthRedirect: "auth_redirect",
	PostAuthRedirect: "post_auth_redirect",
	CallbackCleanup: "callback_cleanup",
	ExternalOpen: "external_open",
} as const;

export type RouterNavigationIntent =
	(typeof RouterNavigationIntent)[keyof typeof RouterNavigationIntent];

export const RouterNavigationMode = {
	Push: "push",
	Replace: "replace",
	External: "external",
} as const;

export type RouterNavigationMode =
	(typeof RouterNavigationMode)[keyof typeof RouterNavigationMode];

export interface RouterNavigationRequest {
	url: UriReferenceString;
	intent: RouterNavigationIntent;
	mode: RouterNavigationMode;
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
		intent: RouterNavigationIntent.CallbackCleanup,
		mode: RouterNavigationMode.Replace,
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
