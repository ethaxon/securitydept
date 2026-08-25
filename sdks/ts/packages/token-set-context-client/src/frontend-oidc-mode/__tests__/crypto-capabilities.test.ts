import { ClientErrorKind } from "@securitydept/client";
import { calculatePKCECodeChallenge, generateRandomState } from "oauth4webapi";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertFrontendOidcCryptoCapabilities } from "../client/crypto-capabilities";
import { FrontendOidcModeErrorCode } from "../client/error-codes";

afterEach(() => vi.unstubAllGlobals());

describe("frontend OIDC Web Crypto capabilities", () => {
	it.each([
		undefined,
		null,
		{},
		{ getRandomValues: true },
	])("reports unavailable random generation for %s", (crypto) => {
		expect(() =>
			assertFrontendOidcCryptoCapabilities({
				crypto,
				isSecureContext: undefined,
				pkceEnabled: false,
			}),
		).toThrow(
			expect.objectContaining({
				kind: ClientErrorKind.Configuration,
				code: FrontendOidcModeErrorCode.WebCryptoUnavailable,
				message: expect.stringContaining("crypto.getRandomValues"),
			}),
		);
	});

	it.each([
		undefined,
		{},
		{ digest: true },
	])("explains missing PKCE support on insecure pages for %s", (subtle) => {
		expect(() =>
			assertFrontendOidcCryptoCapabilities({
				crypto: { getRandomValues: vi.fn(), subtle },
				isSecureContext: false,
				pkceEnabled: true,
			}),
		).toThrow(
			expect.objectContaining({
				code: FrontendOidcModeErrorCode.InsecureContext,
				message: expect.stringContaining("crypto.subtle.digest (SHA-256)"),
			}),
		);
	});

	it("does not mistake HTTPS for available Web Crypto", () => {
		expect(() =>
			assertFrontendOidcCryptoCapabilities({
				crypto: { getRandomValues: vi.fn() },
				isSecureContext: true,
				pkceEnabled: true,
			}),
		).toThrow(
			expect.objectContaining({
				code: FrontendOidcModeErrorCode.WebCryptoUnavailable,
			}),
		);
	});

	it("does not require digest when PKCE is explicitly disabled", () => {
		expect(() =>
			assertFrontendOidcCryptoCapabilities({
				crypto: { getRandomValues: vi.fn() },
				isSecureContext: false,
				pkceEnabled: false,
			}),
		).not.toThrow();
	});

	it("accepts host-provided crypto on insecure pages and uses it in oauth4webapi", async () => {
		const nativeCrypto = globalThis.crypto;
		const getRandomValues = vi.fn(
			nativeCrypto.getRandomValues.bind(nativeCrypto),
		);
		const digest = vi.fn(nativeCrypto.subtle.digest.bind(nativeCrypto.subtle));
		vi.stubGlobal("crypto", { getRandomValues, subtle: { digest } });
		vi.stubGlobal("isSecureContext", false);
		assertFrontendOidcCryptoCapabilities({
			crypto: globalThis.crypto,
			isSecureContext: globalThis.isSecureContext,
			pkceEnabled: true,
		});

		expect(generateRandomState()).toHaveLength(43);
		await expect(
			calculatePKCECodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
		).resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
		expect(getRandomValues).toHaveBeenCalledOnce();
		expect(digest).toHaveBeenCalledWith("SHA-256", expect.any(Uint8Array));
	});
});
