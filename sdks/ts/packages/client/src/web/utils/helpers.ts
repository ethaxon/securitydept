// Browser helper utilities shared across higher-level client packages.

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

/**
 * Rewrite a default-export script into a shape that can be executed via
 * browser async-function evaluation.
 */
export function transformScriptForBrowser(source: string): string {
	return source
		.replace(
			"export default async function",
			"__exports.default = async function",
		)
		.replace("export default function", "__exports.default = function")
		.replace("export default", "__exports.default =");
}
