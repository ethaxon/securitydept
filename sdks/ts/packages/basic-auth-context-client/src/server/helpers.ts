// Server-host helpers for basic-auth-context-client
//
// Provides host-neutral server helpers that wrap BasicAuthContextClient
// for SSR / server-render-host scenarios (Next.js, Remix, Astro,
// plain Node request handlers, etc.).
//
// The host owns HTTP response construction (302 headers, response body).
// These helpers produce redirect instructions the host can act on.

import { BasicAuthContextClient } from "../client";
import type { AuthGuardResult, BasicAuthContextClientConfig } from "../types";
import { AuthGuardResultKind } from "../types";

// ---------------------------------------------------------------------------
// Server request context
// ---------------------------------------------------------------------------

/** Minimal server request context — host-neutral. */
export interface ServerRequestContext {
	/** The request path (e.g. "/api/protected"). */
	path: string;
}

// ---------------------------------------------------------------------------
// Redirect instruction
// ---------------------------------------------------------------------------

/**
 * Server-side redirect instruction for the host to act on.
 *
 * The host translates this into its framework-specific response:
 * - Next.js: `{ redirect: { destination, statusCode } }`
 * - Express: `res.redirect(statusCode, destination)`
 * - etc.
 */
export interface ServerRedirectInstruction {
	/** HTTP redirect status code. */
	statusCode: number;
	/** Redirect target URL. */
	destination: string;
}

// ---------------------------------------------------------------------------
// Helper options
// ---------------------------------------------------------------------------

/** Options for {@link createBasicAuthServerHelper}. */
export interface CreateBasicAuthServerHelperOptions {
	/** BasicAuthContextClient config — same shape as the browser client. */
	config: BasicAuthContextClientConfig;
}

// ---------------------------------------------------------------------------
// Helper interface
// ---------------------------------------------------------------------------

/** Server-host helper for basic-auth zone-based redirect logic. */
export interface BasicAuthServerHelper {
	/** The underlying BasicAuthContextClient instance. */
	readonly client: BasicAuthContextClient;

	/**
	 * Handle a 401 response from the backend in a server context.
	 *
	 * If the request path falls inside a configured zone, returns a
	 * redirect instruction. Otherwise returns `null`.
	 */
	handleUnauthorized(
		context: ServerRequestContext,
	): ServerRedirectInstruction | null;

	/**
	 * Build the login URL for a specific path.
	 *
	 * Returns the login URL for the zone containing the path,
	 * or `null` if the path isn't in any zone.
	 */
	loginUrlForPath(path: string): string | null;

	/**
	 * Build the logout URL for a specific path.
	 *
	 * Returns the logout URL for the zone containing the path,
	 * or `null` if the path isn't in any zone.
	 */
	logoutUrlForPath(path: string): string | null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a server-host helper for basic-auth zone management.
 *
 * @example
 * ```ts
 * const helper = createBasicAuthServerHelper({
 *   config: { baseUrl: "https://auth.example.com", zones: [{ zonePrefix: "/api" }] },
 * });
 *
 * // In a server request handler:
 * const redirect = helper.handleUnauthorized({ path: "/api/data" });
 * if (redirect) {
 *   return Response.redirect(redirect.destination, redirect.statusCode);
 * }
 * ```
 */
export function createBasicAuthServerHelper(
	options: CreateBasicAuthServerHelperOptions,
): BasicAuthServerHelper {
	const client = new BasicAuthContextClient(options.config);

	return {
		client,

		handleUnauthorized(
			context: ServerRequestContext,
		): ServerRedirectInstruction | null {
			const result: AuthGuardResult<null> = client.handleUnauthorized(
				context.path,
				401,
			);

			if (result.kind === AuthGuardResultKind.Redirect) {
				return {
					statusCode: result.status,
					destination: result.location,
				};
			}

			return null;
		},

		loginUrlForPath(path: string): string | null {
			const zone = client.zoneForPath(path);
			if (!zone) return null;
			return client.loginUrl(zone, path);
		},

		logoutUrlForPath(path: string): string | null {
			const zone = client.zoneForPath(path);
			if (!zone) return null;
			return client.logoutUrl(zone);
		},
	};
}
