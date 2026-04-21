// Frontend OIDC Mode — cross-boundary contracts
//
// These types define the cross-boundary contracts between the frontend
// OIDC browser client and the backend. They are aligned with the Rust
// `frontend_oidc_mode` contracts in securitydept-token-set-context.
//
// Layer distinction:
//   - browser runtime types: FrontendOidcModeClientConfig, FrontendOidcModeAuthorizeParams, etc.
//     → owned by the browser OIDC client (client.ts / types.ts)
//   - cross-boundary contracts: FrontendOidcModeConfigProjection
//     → aligned with Rust, defines the config interop contract between frontend and backend
//
// User info contracts are included: the frontend uses `userinfoRequest()` from
// oauth4webapi to fetch claims directly from the provider's userinfo endpoint.

import {
	type AuthenticatedPrincipal,
	createSchema,
	validateWithSchemaSync,
} from "@securitydept/client";
import type {
	FrontendOidcModeClientConfig,
	FrontendOidcModeTokenResult,
} from "./types";

// ---------------------------------------------------------------------------
// Claims check script (aligned with Rust FrontendOidcModeClaimsCheckScript)
// ---------------------------------------------------------------------------

/**
 * Structured claims check script delivered in the config projection.
 *
 * This is the TS equivalent of Rust `FrontendOidcModeClaimsCheckScript`.
 * Currently only `inline` is supported; future variants (e.g. a signed URL)
 * can be added without breaking existing consumers.
 */
export type FrontendOidcModeClaimsCheckScript =
	/** Script content is embedded inline by the backend. */
	{ type: "inline"; content: string };

// ---------------------------------------------------------------------------
// Claims check result (aligned with Rust ScriptClaimsCheckResult)
// ---------------------------------------------------------------------------

/**
 * Successful claims check result.
 *
 * Returned when the claims check script (or default logic) accepts the
 * ID token + userInfo claims and produces a normalized identity.
 */
export interface FrontendOidcModeClaimsCheckSuccessResult {
	success: true;
	displayName: string;
	picture?: string;
	claims: Record<string, unknown>;
}

/**
 * Failed claims check result.
 *
 * Returned when the claims check script explicitly rejects the claims.
 */
export interface FrontendOidcModeClaimsCheckFailureResult {
	success: false;
	error?: string;
	claims?: unknown;
}

/**
 * Discriminated union for claims check results.
 *
 * Aligned with Rust `ScriptClaimsCheckResult` (untagged serde).
 */
export type FrontendOidcModeClaimsCheckResult =
	| FrontendOidcModeClaimsCheckSuccessResult
	| FrontendOidcModeClaimsCheckFailureResult;

// ---------------------------------------------------------------------------
// Config projection (aligned with Rust FrontendOidcModeConfigProjection)
// ---------------------------------------------------------------------------

/**
 * Backend-to-frontend OIDC configuration projection.
 *
 * The backend exposes this so the frontend can initialize its OIDC client
 * against the same provider. This is the TS equivalent of Rust
 * `FrontendOidcModeConfigProjection`.
 *
 * Faithfully reflects the resolved `OidcClientConfig` minus server-only
 * fields (`pendingStore`, `devicePollInterval`).
 *
 * `clientSecret` is only populated when `UnsafeFrontendClientSecret` capability
 * is enabled on the server.
 */
export interface FrontendOidcModeConfigProjection {
	// --- Provider connectivity (from OAuthProviderRemoteConfig) ---

	/** OIDC discovery URL (e.g. `https://auth.example.com/.well-known/openid-configuration`). */
	wellKnownUrl?: string;
	/** Issuer URL. When `wellKnownUrl` is set, this is derived from discovery; when not, use directly. */
	issuerUrl?: string;
	/** JWKS URI for direct key fetching without discovery. */
	jwksUri?: string;
	/** How often to refresh provider discovery metadata (human-readable duration, e.g. "5m"). */
	metadataRefreshInterval?: string;
	/** How often to refresh the remote JWKS (human-readable duration, e.g. "5m"). */
	jwksRefreshInterval?: string;

	// --- Provider OIDC endpoint overrides ---

	/** Authorization endpoint override. `undefined` means "derived from discovery." */
	authorizationEndpoint?: string;
	/** Token endpoint override. `undefined` means "derived from discovery." */
	tokenEndpoint?: string;
	/** UserInfo endpoint override. `undefined` means "derived from discovery." */
	userinfoEndpoint?: string;
	/** Revocation endpoint override. `undefined` means "derived from discovery." */
	revocationEndpoint?: string;
	/**
	 * Supported token endpoint authentication methods.
	 * `undefined` means "use provider discovery."
	 */
	tokenEndpointAuthMethodsSupported?: string[];
	/**
	 * Supported algorithms for signing ID tokens.
	 * `undefined` means "use provider discovery."
	 */
	idTokenSigningAlgValuesSupported?: string[];
	/**
	 * Supported algorithms for signing UserInfo responses.
	 * `undefined` means "use provider discovery."
	 */
	userinfoSigningAlgValuesSupported?: string[];

	/** The `client_id` for authorization requests. */
	clientId: string;
	/**
	 * **Unsafe.** Only populated when `UnsafeFrontendClientSecret` capability is
	 * enabled. The frontend should log a warning when this field is present.
	 */
	clientSecret?: string;
	/** Scopes to request. */
	scopes?: string[];
	/** Scopes that MUST be present in the token endpoint response. */
	requiredScopes?: string[];
	/** The redirect URL for the OIDC callback. */
	redirectUrl: string;
	/** Whether PKCE is enabled for the authorization code flow. */
	pkceEnabled?: boolean;
	/**
	 * Claims check script for client-side evaluation.
	 *
	 * The backend read the script from the filesystem and inlined it here.
	 * Currently only `inline` is supported.
	 */
	claimsCheckScript?: FrontendOidcModeClaimsCheckScript;

	/**
	 * Epoch-millisecond timestamp of when this projection was generated by
	 * the backend. This is the **authoritative freshness signal** for all
	 * downstream sources (bootstrap_script, persisted, network).
	 *
	 * Clients compare this against a max-age policy to decide whether an
	 * idle revalidation is needed.
	 */
	generatedAt: number;
}

// ---------------------------------------------------------------------------
// Adapters: config projection → browser runtime config
// ---------------------------------------------------------------------------

/**
 * Convert a backend config projection into a browser runtime client config.
 *
 * This bridges the backend-provided projection (REST endpoint response)
 * to the browser OIDC client config used by `FrontendOidcModeClient`.
 *
 * All projection fields are mapped through to their `FrontendOidcModeClientConfig`
 * counterparts, including endpoint overrides, protocol control, JWKS metadata,
 * and claims check script.
 *
 * When `clientSecret` is present in the projection (unsafe capability),
 * the adapter logs a warning and passes it through.
 */
export function configProjectionToClientConfig(
	projection: FrontendOidcModeConfigProjection,
	overrides?: Partial<
		Pick<
			FrontendOidcModeClientConfig,
			"redirectUri" | "defaultPostAuthRedirectUri"
		>
	>,
): FrontendOidcModeClientConfig {
	// Derive issuer: prefer issuerUrl, then strip discovery suffix from wellKnownUrl
	const issuer =
		projection.issuerUrl ??
		projection.wellKnownUrl?.replace(
			/\/\.well-known\/openid-configuration\/?$/,
			"",
		) ??
		"";

	if (projection.clientSecret) {
		console.warn(
			"[securitydept] ⚠️  SECURITY WARNING: the server exposed client_secret to the " +
				"browser via UnsafeFrontendClientSecret capability. This is a security " +
				"anti-pattern. Contact your administrator.",
		);
	}

	return {
		issuer,
		clientId: projection.clientId,
		scopes: projection.scopes,
		redirectUri: overrides?.redirectUri ?? projection.redirectUrl,
		defaultPostAuthRedirectUri: overrides?.defaultPostAuthRedirectUri,
		// Endpoint overrides
		authorizationEndpoint: projection.authorizationEndpoint,
		tokenEndpoint: projection.tokenEndpoint,
		userinfoEndpoint: projection.userinfoEndpoint,
		revocationEndpoint: projection.revocationEndpoint,
		// Protocol control
		pkceEnabled: projection.pkceEnabled,
		clientSecret: projection.clientSecret,
		requiredScopes: projection.requiredScopes,
		claimsCheckScript: projection.claimsCheckScript,
		// Provider metadata
		jwksUri: projection.jwksUri,
		metadataRefreshInterval: projection.metadataRefreshInterval,
		jwksRefreshInterval: projection.jwksRefreshInterval,
		tokenEndpointAuthMethodsSupported:
			projection.tokenEndpointAuthMethodsSupported,
		idTokenSigningAlgValuesSupported:
			projection.idTokenSigningAlgValuesSupported,
		userinfoSigningAlgValuesSupported:
			projection.userinfoSigningAlgValuesSupported,
	};
}

// ---------------------------------------------------------------------------
// Internal helpers for schema validation
// ---------------------------------------------------------------------------

/**
 * Validate that an optional field, when present as an array, contains only strings.
 * Returns an issue result if invalid, or null if valid (assigns to projection).
 */
function validateStringArrayField(
	raw: Record<string, unknown>,
	field: keyof FrontendOidcModeConfigProjection,
	projection: FrontendOidcModeConfigProjection,
): { issues: ReadonlyArray<{ message: string; path: PropertyKey[] }> } | null {
	if (raw[field] === undefined) return null;
	if (!Array.isArray(raw[field])) {
		return {
			issues: [
				{
					message: `${field} must be an array of strings when present`,
					path: [field],
				},
			],
		};
	}
	const arr = raw[field] as unknown[];
	for (let i = 0; i < arr.length; i++) {
		if (typeof arr[i] !== "string") {
			return {
				issues: [
					{
						message: `${field}[${i}] must be a string`,
						path: [field, i],
					},
				],
			};
		}
	}
	// Safe cast — all elements verified as strings.
	(projection as unknown as Record<string, unknown>)[field] = arr as string[];
	return null;
}

// ---------------------------------------------------------------------------
// Config projection validation schema (@standard-schema aligned)
// ---------------------------------------------------------------------------

/**
 * Schema for validating a raw `FrontendOidcModeConfigProjection` from an
 * untrusted cross-boundary source (e.g. a REST endpoint response body).
 *
 * Validates required fields (`clientId`, `redirectUrl`) and checks
 * structural correctness of the configuration projection.
 */
export const FrontendOidcModeConfigProjectionSchema =
	createSchema<FrontendOidcModeConfigProjection>({
		validate(input: unknown) {
			if (typeof input !== "object" || input === null) {
				return {
					issues: [
						{
							message: "Expected an object for config projection",
						},
					],
				};
			}

			const raw = input as Record<string, unknown>;

			if (typeof raw.clientId !== "string" || !raw.clientId) {
				return {
					issues: [
						{
							message: "clientId is required and must be a non-empty string",
							path: ["clientId"],
						},
					],
				};
			}

			if (typeof raw.redirectUrl !== "string" || !raw.redirectUrl) {
				return {
					issues: [
						{
							message: "redirectUrl is required and must be a non-empty string",
							path: ["redirectUrl"],
						},
					],
				};
			}

			const projection: FrontendOidcModeConfigProjection = {
				clientId: raw.clientId,
				redirectUrl: raw.redirectUrl,
				// Default to 0; overwritten below if present in payload.
				generatedAt: 0,
			};

			// Optional string fields.
			if (typeof raw.wellKnownUrl === "string")
				projection.wellKnownUrl = raw.wellKnownUrl;
			if (typeof raw.issuerUrl === "string")
				projection.issuerUrl = raw.issuerUrl;
			if (typeof raw.jwksUri === "string") projection.jwksUri = raw.jwksUri;
			if (typeof raw.metadataRefreshInterval === "string")
				projection.metadataRefreshInterval = raw.metadataRefreshInterval;
			if (typeof raw.jwksRefreshInterval === "string")
				projection.jwksRefreshInterval = raw.jwksRefreshInterval;
			if (typeof raw.authorizationEndpoint === "string")
				projection.authorizationEndpoint = raw.authorizationEndpoint;
			if (typeof raw.tokenEndpoint === "string")
				projection.tokenEndpoint = raw.tokenEndpoint;
			if (typeof raw.userinfoEndpoint === "string")
				projection.userinfoEndpoint = raw.userinfoEndpoint;
			if (typeof raw.revocationEndpoint === "string")
				projection.revocationEndpoint = raw.revocationEndpoint;
			if (typeof raw.clientSecret === "string")
				projection.clientSecret = raw.clientSecret;
			if (typeof raw.pkceEnabled === "boolean")
				projection.pkceEnabled = raw.pkceEnabled;

			// Optional string array fields — validate elements are strings.
			const stringArrayResult = validateStringArrayField(
				raw,
				"scopes",
				projection,
			);
			if (stringArrayResult) return stringArrayResult;

			const requiredScopesResult = validateStringArrayField(
				raw,
				"requiredScopes",
				projection,
			);
			if (requiredScopesResult) return requiredScopesResult;

			const tokenAuthResult = validateStringArrayField(
				raw,
				"tokenEndpointAuthMethodsSupported",
				projection,
			);
			if (tokenAuthResult) return tokenAuthResult;

			const idTokenAlgResult = validateStringArrayField(
				raw,
				"idTokenSigningAlgValuesSupported",
				projection,
			);
			if (idTokenAlgResult) return idTokenAlgResult;

			const userinfoAlgResult = validateStringArrayField(
				raw,
				"userinfoSigningAlgValuesSupported",
				projection,
			);
			if (userinfoAlgResult) return userinfoAlgResult;

			// Claims check script — reject structurally invalid objects.
			if (raw.claimsCheckScript !== undefined) {
				if (
					typeof raw.claimsCheckScript !== "object" ||
					raw.claimsCheckScript === null
				) {
					return {
						issues: [
							{
								message: "claimsCheckScript must be an object when present",
								path: ["claimsCheckScript"],
							},
						],
					};
				}
				const script = raw.claimsCheckScript as Record<string, unknown>;
				if (script.type !== "inline" || typeof script.content !== "string") {
					return {
						issues: [
							{
								message:
									'claimsCheckScript must have type "inline" and string content',
								path: ["claimsCheckScript"],
							},
						],
					};
				}
				projection.claimsCheckScript = {
					type: "inline",
					content: script.content,
				};
			}

			// generatedAt — authoritative freshness timestamp.
			if (typeof raw.generatedAt === "number" && raw.generatedAt > 0) {
				projection.generatedAt = raw.generatedAt;
			}

			return { value: projection };
		},
	});

/**
 * Validate raw input against `FrontendOidcModeConfigProjectionSchema`.
 *
 * Use this when receiving a config projection from an untrusted source
 * (e.g. parsing a REST response body) to ensure structural correctness
 * before passing it to `configProjectionToClientConfig()`.
 */
export function validateConfigProjection(input: unknown) {
	return validateWithSchemaSync(FrontendOidcModeConfigProjectionSchema, input);
}

/**
 * Parse an untrusted config projection into a browser runtime client config.
 *
 * This is the canonical validated consumption path for cross-boundary config
 * projections. It combines schema validation with the projection-to-config
 * adapter in one step:
 *
 *   `unknown → validated FrontendOidcModeConfigProjection → FrontendOidcModeClientConfig`
 *
 * Returns `{ success: true, value: FrontendOidcModeClientConfig }` on success,
 * or `{ success: false, issues: [...] }` on validation failure.
 *
 * @example
 * ```ts
 * const result = parseConfigProjection(responseBody);
 * if (result.success) {
 *   const client = new FrontendOidcModeClient(result.value, runtime);
 * } else {
 *   console.error("Invalid config projection:", result.issues);
 * }
 * ```
 */
export function parseConfigProjection(
	input: unknown,
	overrides?: Partial<
		Pick<
			FrontendOidcModeClientConfig,
			"redirectUri" | "defaultPostAuthRedirectUri"
		>
	>,
):
	| { success: true; value: FrontendOidcModeClientConfig }
	| import("@securitydept/client").ValidationFailure {
	const validationResult = validateConfigProjection(input);
	if (!validationResult.success) {
		return validationResult;
	}
	return {
		success: true,
		value: configProjectionToClientConfig(validationResult.value, overrides),
	};
}

// ---------------------------------------------------------------------------
// Adapters: browser runtime result → orchestration snapshot
// ---------------------------------------------------------------------------

/**
 * Convert a browser OIDC token result into an orchestration `AuthSnapshot`.
 *
 * This is the formal bridge from the frontend-oidc-mode browser runtime
 * into the shared orchestration substrate (AuthMaterialController).
 */
export function tokenResultToAuthSnapshot(
	result: FrontendOidcModeTokenResult,
	options?: {
		providerId?: string;
		issuer?: string;
	},
): import("../orchestration/types").AuthSnapshot {
	return {
		tokens: {
			accessToken: result.accessToken,
			idToken: result.idToken,
			refreshMaterial: result.refreshToken,
			accessTokenExpiresAt: result.expiresAt,
		},
		metadata: {
			source: {
				kind: "oidc_authorization_code",
				providerId: options?.providerId,
				issuer: options?.issuer,
				kindHistory: ["oidc_authorization_code"],
			},
		},
	};
}

// ---------------------------------------------------------------------------
// User info contract
// ---------------------------------------------------------------------------

/**
 * User info response from the OIDC provider's userinfo endpoint.
 *
 * In frontend-oidc mode, the browser client calls the provider's userinfo
 * endpoint directly using the access token, without involving the backend.
 * This is fundamentally different from backend-oidc mode, where user info
 * retrieval is mediated by the backend.
 */
export interface FrontendOidcModeUserInfoResponse
	extends AuthenticatedPrincipal {
	/** The subject identifier (OIDC `sub` claim). */
	subject: string;
	/** Display name (`name` claim or derived). */
	displayName: string;
	/** Profile picture URL. */
	picture?: string;
	/** Email address. */
	email?: string;
	/** Whether the email is verified. */
	emailVerified?: boolean;
	/** Raw claims from the userinfo response. */
	claims?: Record<string, unknown>;
}
