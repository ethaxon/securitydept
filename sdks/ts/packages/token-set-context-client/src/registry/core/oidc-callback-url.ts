// Shared OIDC callback URL detection
//
// Migrated from @securitydept/token-set-context-client-angular/src/lib
// so both Angular and React adapters share the same callback semantics.

/**
 * Check whether a URL is an OIDC authorization callback for a given client.
 *
 * Returns `true` when the URL's pathname matches `callbackPath` *and*
 * the URL carries either `code` or `error` as a query parameter.
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
