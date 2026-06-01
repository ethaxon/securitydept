import { type TokenSetClientMeta } from "./types";

export type TokenSetClientSelector = (
	meta: TokenSetClientMeta,
	index: number,
) => boolean;

export interface TokenSetClientFilter {
	clientKey?: string;
	url?: string;
	callbackUrl?: string;
	providerFamily?: string;
	requirementKind?: string;
	selector?: TokenSetClientSelector;
}

export type TokenSetClientQueryOptions =
	| TokenSetClientFilter
	| TokenSetClientFilter[];

export interface TokenSetClientQueryTarget {
	readonly meta: TokenSetClientMeta;
}

export function matchesTokenSetClientQuery(
	target: TokenSetClientQueryTarget,
	filter: TokenSetClientFilter,
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
			matchesTokenSetClientUrl(pattern, filter.url as string),
		)
	) {
		return false;
	}
	if (filter.callbackUrl !== undefined) {
		const callbackPath = target.meta.callbackPath;
		if (
			!callbackPath ||
			!matchesTokenSetClientCallbackPath({
				currentUrl: filter.callbackUrl,
				callbackPath,
			})
		) {
			return false;
		}
	}
	return true;
}

export function matchesTokenSetClientCallbackPath(options: {
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

export function matchesTokenSetClientUrl(
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
