import type { AuthGuardResult } from "../types";
import { AuthGuardResultKind } from "../types";

/**
 * Perform a browser redirect for an `AuthGuardResult` that requires redirection.
 */
export function performRedirect(result: AuthGuardResult<unknown>): void {
	if (result.kind === AuthGuardResultKind.Redirect) {
		// Accessing location via window to satisfy strict type checks.
		(globalThis as unknown as { location: { href: string } }).location.href =
			result.location;
	}
}
