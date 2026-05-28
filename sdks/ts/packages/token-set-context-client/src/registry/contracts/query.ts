import { type ClientMeta } from "./types";

export type ClientSelector = (meta: ClientMeta, index: number) => boolean;

export interface ClientFilter {
	clientKey?: string;
	url?: string;
	callbackUrl?: string;
	providerFamily?: string;
	requirementKind?: string;
	selector?: ClientSelector;
}

export type ClientQueryOptions = ClientFilter | ClientFilter[];

export interface ClientQueryTarget {
	readonly meta: ClientMeta;
}

export function matchesQuery(
	target: ClientQueryTarget,
	filter: ClientFilter,
): boolean {
	if (
		filter.clientKey !== undefined &&
		target.meta.clientKey !== filter.clientKey
	) {
		return false;
	}
	if (
		filter.requirementKind !== undefined &&
		target.meta.requirementKind !== filter.requirementKind
	) {
		return false;
	}
	if (
		filter.providerFamily !== undefined &&
		target.meta.providerFamily !== filter.providerFamily
	) {
		return false;
	}
	if (
		filter.url !== undefined &&
		!target.meta.urlPatterns.some((pattern) =>
			matchesUrl(pattern, filter.url as string),
		)
	) {
		return false;
	}
	if (filter.callbackUrl !== undefined) {
		const callbackPath = target.meta.callbackPath;
		if (
			!callbackPath ||
			!matchesCallbackPath({
				currentUrl: filter.callbackUrl,
				callbackPath,
			})
		) {
			return false;
		}
	}
	return true;
}

export function matchesCallbackPath(options: {
	currentUrl: string;
	callbackPath: string;
}): boolean {
	try {
		const url = new URL(options.currentUrl);
		const callbackUrl = new URL(options.callbackPath, url.origin);
		return url.pathname === callbackUrl.pathname;
	} catch {
		return false;
	}
}

export function matchesUrl(
	pattern: string | RegExp | ((u: string) => boolean),
	url: string,
): boolean {
	if (typeof pattern === "string") {
		return url.startsWith(pattern);
	}
	if (typeof pattern === "function") {
		return pattern(url);
	}
	return pattern.test(url);
}
