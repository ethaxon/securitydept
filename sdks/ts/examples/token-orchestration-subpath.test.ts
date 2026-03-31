// Token Orchestration Subpath Contract Test
//
// This test serves as adopter-facing evidence that:
//
//   1. The new @securitydept/token-set-context-client/orchestration subpath is
//      a real, importable entry point for protocol-agnostic token orchestration.
//
//   2. The existing @securitydept/token-set-context-client root import remains
//      backward-compatible — the orchestration exports are still accessible there.
//
// When to prefer the subpath vs the root:
//   - prefer /orchestration when you want ONLY the protocol-agnostic layer
//     (no TokenSetContextClient, no callback/metadata redemption, no ./web surface)
//   - prefer the root import when you already depend on the full token-set surface
//     and need only a few orchestration helpers
//
// Stability of @securitydept/token-set-context-client/orchestration:
//   - provisional (additive, not yet promoted to stable)
//   - NOT a separate npm package — still inside token-set-context-client
//   - the subpath is the recommended entry for protocol-agnostic usage
//
// This file backs the MinimalEntry semantic layer in adopter-clarity-contract.
// It does NOT back VerifiedEnvironments — it proves contract usability, not
// host capability (Node.js/browser/React).

import { createInMemoryRecordStore } from "@securitydept/client";
// --- Root import (backward-compatible) ---
import {
	AuthSourceKind as AuthSourceKindFromRoot,
	bearerHeader as bearerHeaderFromRoot,
	createAuthStatePersistence as createAuthStatePersistenceFromRoot,
} from "@securitydept/token-set-context-client";
import type {
	AuthSnapshot,
	AuthSource,
	TokenDelta,
	TokenSnapshot,
} from "@securitydept/token-set-context-client/orchestration";
// --- Subpath import (recommended for protocol-agnostic usage) ---
import {
	AuthSourceKind,
	bearerHeader,
	createAuthorizedTransport,
	createAuthStatePersistence,
	mergeTokenDelta,
} from "@securitydept/token-set-context-client/orchestration";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// A. Subpath entry — all orchestration exports are importable directly
// ---------------------------------------------------------------------------

describe("token orchestration / subpath entry (@.../orchestration)", () => {
	it("exports AuthSourceKind with correct token-family field values", () => {
		expect(AuthSourceKind.OidcAuthorizationCode).toBe(
			"oidc_authorization_code",
		);
		expect(AuthSourceKind.RefreshToken).toBe("refresh_token");
		expect(AuthSourceKind.ForwardedBearer).toBe("forwarded_bearer");
		expect(AuthSourceKind.Unknown).toBe("unknown");
	});

	it("exports bearerHeader from /orchestration subpath", () => {
		const snapshot: TokenSnapshot = { accessToken: "subpath-at" };
		expect(bearerHeader(snapshot)).toBe("Bearer subpath-at");
		expect(bearerHeader(null)).toBeNull();
	});

	it("exports mergeTokenDelta and correctly merges absent delta fields", () => {
		const base: TokenSnapshot = {
			accessToken: "base-at",
			idToken: "base-id",
			refreshMaterial: "base-rt",
		};
		const delta: TokenDelta = { accessToken: "new-at" };
		const merged = mergeTokenDelta(base, delta);
		expect(merged.accessToken).toBe("new-at");
		expect(merged.idToken).toBe("base-id");
		expect(merged.refreshMaterial).toBe("base-rt");
	});

	it("composes persistence + bearer via subpath — no token-set sealed fields", async () => {
		const store = createInMemoryRecordStore();
		const persistence = createAuthStatePersistence({
			store,
			key: "subpath-adopter:v1",
			now: Date.now,
		});

		const snapshot: AuthSnapshot = {
			tokens: { accessToken: "oidc-at", refreshMaterial: "oidc-rt" },
			metadata: {
				source: {
					kind: AuthSourceKind.OidcAuthorizationCode,
					providerId: "idp-a",
				} satisfies AuthSource,
			},
		};

		await persistence.save(snapshot);
		const loaded = await persistence.load();
		expect(loaded?.tokens.accessToken).toBe("oidc-at");
		expect(bearerHeader(loaded?.tokens ?? null)).toBe("Bearer oidc-at");
	});

	it("createAuthorizedTransport from /orchestration injects authorization header", async () => {
		const captured: string[] = [];
		const transport = createAuthorizedTransport(
			{ authorizationHeader: () => "Bearer subpath-injected" },
			{
				transport: {
					async execute(req) {
						captured.push(req.headers.authorization ?? "(none)");
						return { status: 200, headers: {} };
					},
				},
			},
		);

		await transport.execute({
			url: "https://api.example.com/res",
			method: "GET",
			headers: {},
		});

		expect(captured[0]).toBe("Bearer subpath-injected");
	});
});

// ---------------------------------------------------------------------------
// B. Root backward-compat — orchestration exports still accessible from root
// ---------------------------------------------------------------------------

describe("token orchestration / root backward-compat", () => {
	it("AuthSourceKind is the same constant object from root and subpath", () => {
		// Both should have identical values — they're the same source.
		expect(AuthSourceKindFromRoot.OidcAuthorizationCode).toBe(
			AuthSourceKind.OidcAuthorizationCode,
		);
		expect(AuthSourceKindFromRoot.Unknown).toBe(AuthSourceKind.Unknown);
	});

	it("bearerHeader from root produces identical output to subpath", () => {
		const snapshot: TokenSnapshot = { accessToken: "compat-at" };
		expect(bearerHeaderFromRoot(snapshot)).toBe(bearerHeader(snapshot));
	});

	it("createAuthStatePersistence round-trips identically from root", async () => {
		const store = createInMemoryRecordStore();
		const persistence = createAuthStatePersistenceFromRoot({
			store,
			key: "root-compat:v1",
			now: Date.now,
		});

		const snapshot: AuthSnapshot = {
			tokens: { accessToken: "root-at" },
			metadata: {},
		};

		await persistence.save(snapshot);
		const loaded = await persistence.load();
		expect(loaded?.tokens.accessToken).toBe("root-at");
	});
});
