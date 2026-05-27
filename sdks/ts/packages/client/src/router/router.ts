import { type as defineType } from "arktype";
import { SecuritydeptInjectionToken } from "../injection";

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

export const RouterTraitSchema = defineType({
	currentUrl: "Function",
	navigate: "Function",
});

export const ROUTER_TRAIT_TOKEN =
	new SecuritydeptInjectionToken<RouterTrait | null>("ROUTER_TRAIT_TOKEN");
