import { UriReferenceString } from "@securitydept/client";
import {
	type TokenSetClientCallbackUrls,
	type TokenSetClientMeta,
	type TokenSetRequirementKind,
} from "./types";

export type TokenSetClientSelector = (
	meta: TokenSetClientMeta,
	index: number,
) => boolean;

export interface TokenSetClientFilter {
	clientKey?: string;
	url?: string;
	callbackUrl?: TokenSetClientCallbackUrls;
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
		const callbackUrlCandidates = target.meta.callbackUrl;
		if (
			!callbackUrlCandidates ||
			!matchesTokenSetClientCallbackUrl({
				currentUrl: filter.callbackUrl,
				callbackUrlCandidates,
			})
		) {
			return false;
		}
	}
	return true;
}

export function matchesTokenSetClientCallbackUrl(options: {
	currentUrl: TokenSetClientCallbackUrls;
	callbackUrlCandidates: TokenSetClientCallbackUrls;
}): boolean {
	try {
		const currentUrls = Array.isArray(options.currentUrl)
			? options.currentUrl
			: [options.currentUrl];
		const callbackUrlCandidates = Array.isArray(options.callbackUrlCandidates)
			? options.callbackUrlCandidates
			: [options.callbackUrlCandidates];
		return callbackUrlCandidates.some((callbackUrl) => {
			const callbackPathname = UriReferenceString.parse(callbackUrl).pathname;
			return currentUrls.some(
				(currentUrl) =>
					UriReferenceString.parse(currentUrl).pathname === callbackPathname,
			);
		});
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
