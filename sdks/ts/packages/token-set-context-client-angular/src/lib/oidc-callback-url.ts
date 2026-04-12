// ============================================================================
// 8. Callback helper — OIDC redirect callback with multi-client discrimination
// ============================================================================

/**
 * Check whether the current URL is an OIDC authorization callback.
 */
export function isOidcCallback(options: {
	currentUrl: string;
	callbackPath: string;
}): boolean {
	try {
		const url = new URL(options.currentUrl);
		const callbackUrl = new URL(options.callbackPath, url.origin);
		return (
			url.pathname === callbackUrl.pathname &&
			(url.searchParams.has("code") || url.searchParams.has("error"))
		);
	} catch {
		return false;
	}
}
