import {
	RouterNavigationMode,
	type RouterNavigationRequest,
	type RouterTrait,
} from "../router/router";
import { UriReferenceString } from "../struct/uri-string";

export interface RouterForTestCreateOptions {
	currentUrl?: string | UriReferenceString | null;
	onNavigate?: (request: RouterNavigationRequest) => void | Promise<void>;
}

export interface TestRouterTrait extends RouterTrait {
	readonly navigations: readonly RouterNavigationRequest[];
	setCurrentUrl(url: string | UriReferenceString | null): void;
}

export function createRouterForTest(
	options: RouterForTestCreateOptions = {},
): TestRouterTrait {
	let currentUrl =
		options.currentUrl == null
			? null
			: UriReferenceString.parse(options.currentUrl);
	const navigations: RouterNavigationRequest[] = [];
	return {
		currentUrl() {
			return currentUrl;
		},
		setCurrentUrl(url) {
			currentUrl = url == null ? null : UriReferenceString.parse(url);
		},
		get navigations() {
			return navigations;
		},
		async navigate(request) {
			navigations.push(request);
			if (
				request.mode === RouterNavigationMode.Push ||
				request.mode === RouterNavigationMode.Replace
			) {
				currentUrl = request.url;
			}
			await options.onNavigate?.(request);
		},
	};
}
