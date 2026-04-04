import type { AuthTokenDelta, AuthTokenSnapshot } from "./types";

/**
 * Parse token data from a URL hash fragment.
 *
 * The server redirects to `{callback}#{fragment}` where the fragment contains
 * form-urlencoded token fields. This mirrors the server-side
 * `AuthTokenSnapshotRedirectFragment.to_fragment()`.
 */
export function parseTokenFragment(fragment: string): {
	tokens: AuthTokenSnapshot;
	metadataRedemptionId?: string;
} {
	const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
	const params = new URLSearchParams(raw);

	return {
		tokens: {
			accessToken: params.get("access_token") ?? "",
			idToken: params.get("id_token") ?? undefined,
			refreshMaterial: params.get("refresh_token") ?? undefined,
			accessTokenExpiresAt: params.get("expires_at") ?? undefined,
		},
		metadataRedemptionId: params.get("metadata_redemption_id") ?? undefined,
	};
}

/**
 * Parse a delta token fragment (from refresh redirect).
 */
export function parseDeltaFragment(fragment: string): {
	tokens: AuthTokenDelta;
	metadataRedemptionId?: string;
} {
	// Same wire format as snapshot — the distinction is semantic.
	const result = parseTokenFragment(fragment);
	return {
		tokens: result.tokens,
		metadataRedemptionId: result.metadataRedemptionId,
	};
}

/**
 * Merge a delta into an existing snapshot, producing a new snapshot.
 *
 * Fields present in the delta override the snapshot.
 * Fields absent in the delta preserve the snapshot value.
 */
export function mergeTokenDelta(
	snapshot: AuthTokenSnapshot,
	delta: AuthTokenDelta,
): AuthTokenSnapshot {
	return {
		accessToken: delta.accessToken,
		idToken: delta.idToken ?? snapshot.idToken,
		refreshMaterial: delta.refreshMaterial ?? snapshot.refreshMaterial,
		accessTokenExpiresAt:
			delta.accessTokenExpiresAt ?? snapshot.accessTokenExpiresAt,
	};
}
