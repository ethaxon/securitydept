import { ClientError, ClientErrorKind } from "@securitydept/client";
import {
	FrontendOidcModeErrorCode,
	FrontendOidcModeErrorSource,
} from "./error-codes";

export function assertFrontendOidcCryptoCapabilities(options: {
	crypto:
		| { getRandomValues?: unknown; subtle?: { digest?: unknown } }
		| null
		| undefined;
	isSecureContext: boolean | undefined;
	pkceEnabled: boolean;
}): void {
	const missing: string[] = [];
	if (typeof options.crypto?.getRandomValues !== "function") {
		missing.push("crypto.getRandomValues");
	}
	if (
		options.pkceEnabled &&
		typeof options.crypto?.subtle?.digest !== "function"
	) {
		missing.push("crypto.subtle.digest (SHA-256)");
	}
	if (missing.length === 0) {
		return;
	}

	// A host-installed polyfill can supply the API even on an insecure page.
	const insecureContext = options.isSecureContext === false;
	throw new ClientError({
		kind: ClientErrorKind.Configuration,
		code: insecureContext
			? FrontendOidcModeErrorCode.InsecureContext
			: FrontendOidcModeErrorCode.WebCryptoUnavailable,
		source: FrontendOidcModeErrorSource.Client,
		message: `Frontend OIDC requires ${missing.join(", ")}. ${
			insecureContext
				? "This page is not a secure context. Use HTTPS or localhost"
				: "Provide Web Crypto in this runtime"
		}, or install compatible globalThis.crypto polyfills before creating the SDK environment and client. Polyfills do not secure HTTP transport.`,
	});
}
