import { InjectionToken } from "@angular/core";
import type { TokenSetAuthRegistry } from "./token-set-auth-registry";

/** InjectionToken for the multi-client auth registry. */
export const TOKEN_SET_AUTH_REGISTRY = new InjectionToken<TokenSetAuthRegistry>(
	"TOKEN_SET_AUTH_REGISTRY",
);

export type TokenSetCallbackUrlSource = () => string | undefined;

export interface TokenSetCallbackComponentOptions {
	fallbackUrl?: string;
	errorRedirectUrl?: string;
	onError?: (error: unknown) => void;
}

/**
 * InjectionToken for the current callback URL used by the drop-in callback component.
 *
 * Defaults to `window.location.href` in real page hosts and `undefined` in
 * non-page or test hosts unless explicitly overridden.
 */
export const TOKEN_SET_CALLBACK_CURRENT_URL =
	new InjectionToken<TokenSetCallbackUrlSource>(
		"TOKEN_SET_CALLBACK_CURRENT_URL",
		{
			providedIn: "root",
			factory: () => () => {
				const windowLike = (
					globalThis as { window?: { location?: { href?: string } } }
				).window;
				return windowLike?.location?.href;
			},
		},
	);

export const TOKEN_SET_CALLBACK_COMPONENT_OPTIONS =
	new InjectionToken<TokenSetCallbackComponentOptions>(
		"TOKEN_SET_CALLBACK_COMPONENT_OPTIONS",
		{
			providedIn: "root",
			factory: () => ({
				fallbackUrl: "/",
				errorRedirectUrl: "/",
			}),
		},
	);
