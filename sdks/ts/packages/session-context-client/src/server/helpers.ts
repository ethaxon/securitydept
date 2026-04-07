// Server-host helpers for session-context-client
//
// Provides host-neutral server helpers that wrap SessionContextClient
// for SSR / server-render-host scenarios (Next.js, Remix, Astro,
// plain Node request handlers, etc.).
//
// Key design:
//   - The host provides incoming request headers (cookies, forwarded-for, etc.)
//   - The helper creates a cookie-forwarding transport wrapper
//   - fetchMe, login URL, logout URL are all server-host-safe

import type { HttpTransport } from "@securitydept/client";
import { SessionContextClient } from "../client";
import type { SessionContextClientConfig, SessionInfo } from "../types";

// ---------------------------------------------------------------------------
// Server request context
// ---------------------------------------------------------------------------

/** Minimal server request context — host-neutral. */
export interface ServerRequestContext {
	/**
	 * Incoming request headers from the server host.
	 *
	 * The helper uses `cookie` (and optionally other headers) to build
	 * a forwarding transport. The host controls which headers to pass.
	 */
	headers: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helper options
// ---------------------------------------------------------------------------

/** Options for {@link createSessionServerHelper}. */
export interface CreateSessionServerHelperOptions {
	/** SessionContextClient config — same shape as the browser client. */
	config: SessionContextClientConfig;
	/**
	 * The underlying HTTP transport used for server-side requests.
	 *
	 * The helper wraps this transport to inject forwarded headers.
	 * Typically a simple `fetch`-based transport.
	 */
	transport: HttpTransport;
}

// ---------------------------------------------------------------------------
// Helper interface
// ---------------------------------------------------------------------------

/** Server-host helper for session-based auth in SSR contexts. */
export interface SessionServerHelper {
	/** The underlying SessionContextClient instance. */
	readonly client: SessionContextClient;

	/**
	 * Fetch the current user session using forwarded request headers.
	 *
	 * Returns `SessionInfo` if authenticated, `null` if not.
	 * The host's cookies are forwarded via the transport.
	 */
	fetchMe(context: ServerRequestContext): Promise<SessionInfo | null>;

	/** Build the login URL (server-host-safe, no browser globals). */
	loginUrl(postAuthRedirectUri?: string): string;

	/** Build the logout URL (server-host-safe, no browser globals). */
	logoutUrl(): string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a server-host helper for session-based auth.
 *
 * @example
 * ```ts
 * const helper = createSessionServerHelper({
 *   config: { baseUrl: "https://auth.example.com" },
 *   transport: fetchTransport, // your HTTP transport
 * });
 *
 * // In a server request handler:
 * const session = await helper.fetchMe({
 *   headers: { cookie: req.headers.cookie ?? "" },
 * });
 *
 * if (!session) {
 *   return Response.redirect(helper.loginUrl("/protected"), 302);
 * }
 * ```
 */
export function createSessionServerHelper(
	options: CreateSessionServerHelperOptions,
): SessionServerHelper {
	const client = new SessionContextClient(options.config);
	const baseTransport = options.transport;

	return {
		client,

		async fetchMe(context: ServerRequestContext): Promise<SessionInfo | null> {
			// Create a forwarding transport that injects the request headers.
			const forwardingTransport: HttpTransport = {
				async execute(request) {
					return baseTransport.execute({
						...request,
						headers: {
							...context.headers,
							...request.headers,
						},
					});
				},
			};

			return client.fetchMe(forwardingTransport);
		},

		loginUrl(postAuthRedirectUri?: string): string {
			return client.loginUrl(postAuthRedirectUri);
		},

		logoutUrl(): string {
			return client.logoutUrl();
		},
	};
}
