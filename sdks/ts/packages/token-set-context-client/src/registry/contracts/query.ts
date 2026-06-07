import { UriReferenceString } from "@securitydept/client";
import { type TokenSetClientMeta, type TokenSetRequirementKind } from "./types";

export type TokenSetClientSelector = (
	meta: TokenSetClientMeta,
	index: number,
) => boolean;

export interface TokenSetClientFilter {
	clientKey?: string;
	url?: string;
	callbackUrl?: string | { pathname: string };
	providerFamily?: string;
	requirementKind?: TokenSetRequirementKind | string;
	selector?: TokenSetClientSelector;
}

export type TokenSetClientQueryOptions =
	| TokenSetClientFilter
	| TokenSetClientFilter[];

export interface TokenSetClientQueryTarget {
	readonly meta: TokenSetClientMeta;
}

type TokenSetClientCallbackPathLike = string | { pathname: string };

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
	currentUrl: TokenSetClientCallbackPathLike;
	callbackPath: TokenSetClientCallbackPathLike;
}): boolean {
	try {
		const callbackPathname =
			typeof options.callbackPath === "string"
				? UriReferenceString.parse(options.callbackPath).pathname
				: options.callbackPath.pathname;
		const currentPathname =
			typeof options.currentUrl === "string"
				? UriReferenceString.parse(options.currentUrl).pathname
				: options.currentUrl.pathname;
		return callbackPathname === currentPathname;
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
