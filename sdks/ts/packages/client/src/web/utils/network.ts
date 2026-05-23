/**
 * Returns `true` for loopback HTTP URLs that browsers and local tooling often
 * permit during development flows.
 */
export function isLoopbackHttpUrl(url: URL): boolean {
	return (
		url.protocol === "http:" &&
		(url.hostname === "localhost" ||
			url.hostname === "127.0.0.1" ||
			url.hostname === "::1" ||
			url.hostname === "[::1]")
	);
}
