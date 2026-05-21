// Access-token substrate — cross-mode capability contracts
//
// These types define the substrate-level capabilities that are shared across
// all token-set-context modes (frontend-oidc, backend-oidc). They are aligned
// with the Rust `access_token_substrate` module in securitydept-token-set-context.
//
// Key boundary: these are NOT mode-specific capabilities. Token propagation,
// resource-server verification policy, and forwarder configuration are
// substrate concerns that apply regardless of which OIDC mode produced the
// access token.

// ---------------------------------------------------------------------------
// Token propagation capability (aligned with Rust TokenPropagationKind)
// ---------------------------------------------------------------------------

/**
 * Whether token propagation is enabled for this deployment.
 *
 * This is a substrate-level capability, not a mode-level capability axis.
 * It indicates whether the backend supports forwarding validated bearer
 * tokens to downstream services via the propagation endpoint.
 */
export const TokenPropagation = {
	Enabled: "enabled",
	Disabled: "disabled",
} as const;

export type TokenPropagation =
	(typeof TokenPropagation)[keyof typeof TokenPropagation];

// ---------------------------------------------------------------------------
// Substrate integration info (frontend-facing projection)
// ---------------------------------------------------------------------------

/**
 * Substrate-level integration information exposed to the frontend.
 *
 * This tells the frontend whether the backend's access-token substrate
 * supports certain cross-mode capabilities. It is NOT part of any specific
 * OIDC mode's integration requirement — it describes the substrate layer
 * that sits beneath all modes.
 *
 * Aligned with Rust `access_token_substrate` capabilities.
 */
export interface AccessTokenSubstrateIntegrationInfo {
	/** Whether the backend supports token propagation. */
	supportsPropagation?: boolean;
}
