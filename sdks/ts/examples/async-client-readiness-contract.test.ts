/**
 * Async readiness contract evidence (Angular adapter)
 *
 * Proves the full async client initialization path for the Angular adapter
 * built on top of the shared registry core at
 * `@securitydept/token-set-context-client/registry`:
 *   - registry tracks pending async clientFactory (not_initialized → initializing → ready)
 *   - get() returns undefined while initializing (no silent sync assumption)
 *   - whenReady() resolves after factory completes
 *   - metadata lookup (urlPatterns, callbackPath) works while still initializing
 *   - interceptor has explicit not-yet-ready semantics (passthrough without token when initializing)
 *   - interceptor attaches token once client is ready
 *
 * Iteration 110 update: `register(entry)` no longer takes a `DestroyRef`
 * second argument. The Angular registry binds `DestroyRef.onDestroy` via
 * injection at construction time; unit tests that instantiate directly
 * call `registry.dispose()` manually (omitted here for brevity).
 */

import { createSubject, type ReadableSignalTrait } from "@securitydept/client";
import type { AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
import {
	AuthSourceKind,
	EnsureAuthForResourceStatus,
	TokenSetAuthFlowReason,
} from "@securitydept/token-set-context-client/orchestration";
import {
	createTokenSetBearerInterceptor,
	type OidcCallbackClient,
	type OidcModeClient,
	TokenSetAuthRegistry,
} from "@securitydept/token-set-context-client-angular";
import { firstValueFrom, from } from "rxjs";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Shared helpers — mirrors angular-integration-adapter.test.ts pattern
// ---------------------------------------------------------------------------

function createTestSignal<T>(initial: T): {
	signal: ReadableSignalTrait<T>;
	set(value: T): void;
} {
	let value = initial;
	const listeners = new Set<() => void>();
	return {
		signal: {
			get: () => value,
			subscribe(listener: () => void) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		},
		set(newValue: T) {
			value = newValue;
			for (const l of listeners) l();
		},
	};
}

function makeSnapshot(accessToken: string): AuthSnapshot {
	return {
		tokens: {
			accessToken,
			idToken: "id-test",
			accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
		},
		metadata: { source: { kind: AuthSourceKind.OidcAuthorizationCode } },
	};
}

function createMockClient(
	initialState: AuthSnapshot | null = null,
): OidcModeClient & OidcCallbackClient {
	const stateCtrl = createTestSignal<AuthSnapshot | null>(initialState);
	return {
		state: stateCtrl.signal,
		authEvents: createSubject(),
		dispose: vi.fn(),
		restorePersistedState: vi.fn().mockResolvedValue(null),
		authorizationHeader: vi.fn(() => {
			const accessToken = stateCtrl.signal.get()?.tokens?.accessToken;
			return accessToken ? `Bearer ${accessToken}` : null;
		}),
		ensureFreshAuthState: vi
			.fn()
			.mockImplementation(async () => stateCtrl.signal.get()),
		ensureAuthorizationHeader: vi.fn().mockImplementation(async () => {
			const accessToken = stateCtrl.signal.get()?.tokens?.accessToken;
			return accessToken ? `Bearer ${accessToken}` : null;
		}),
		ensureAuthForResource: vi.fn().mockImplementation(async () => {
			const snapshot = stateCtrl.signal.get();
			if (snapshot) {
				const accessToken = snapshot.tokens.accessToken;
				return {
					status: EnsureAuthForResourceStatus.Authenticated,
					snapshot,
					authorizationHeader: accessToken ? `Bearer ${accessToken}` : null,
					freshness: "fresh" as const,
				};
			}
			return {
				status: EnsureAuthForResourceStatus.Unauthenticated,
				snapshot: null,
				authorizationHeader: null,
				reason: TokenSetAuthFlowReason.NoSnapshot,
			};
		}),
		isAuthenticated: () => stateCtrl.signal.get() !== null,
		accessToken: () => stateCtrl.signal.get()?.tokens?.accessToken ?? null,
		handleCallback: vi.fn().mockResolvedValue({
			snapshot: makeSnapshot("tok-callback"),
			postAuthRedirectUri: "/dashboard",
		}),
		loginWithRedirect: vi.fn().mockResolvedValue(undefined),
		authorizeUrl: vi.fn().mockResolvedValue("https://idp.example/auth"),
	} as unknown as OidcModeClient & OidcCallbackClient;
}

/** Entry with sync clientFactory */
function makeSyncEntry(key: string, accessToken: string | null = null) {
	const client = createMockClient(
		accessToken ? makeSnapshot(accessToken) : null,
	);
	return {
		key,
		clientFactory: () => client,
		urlPatterns: [`/api/${key}/`],
		callbackPath: `/auth/${key}/callback`,
		autoRestore: false as const,
	};
}

/** Entry with async clientFactory — resolves after `ms` ms */
function makeAsyncEntry(
	key: string,
	ms = 20,
	accessToken: string | null = null,
) {
	const client = createMockClient(
		accessToken ? makeSnapshot(accessToken) : null,
	);
	return {
		key,
		clientFactory: () =>
			new Promise<typeof client>((resolve) =>
				setTimeout(() => resolve(client), ms),
			),
		urlPatterns: [`/api/${key}/`],
		callbackPath: `/auth/${key}/callback`,
		autoRestore: false as const,
	};
}

// ---------------------------------------------------------------------------
// 1. Registry — async clientFactory readiness lifecycle
// ---------------------------------------------------------------------------

describe("TokenSetAuthRegistry — async clientFactory readiness lifecycle", () => {
	it("transitions not_initialized → initializing → ready", async () => {
		const registry = new TokenSetAuthRegistry();

		expect(registry.readinessState("main")).toBe("not_initialized");

		registry.register(makeAsyncEntry("main", 20) as never);

		expect(registry.readinessState("main")).toBe("initializing");
		expect(registry.isReady("main")).toBe(false);
		// get() must return undefined while still initializing — no sync bypass
		expect(registry.get("main")).toBeUndefined();

		await registry.whenReady("main");

		expect(registry.readinessState("main")).toBe("ready");
		expect(registry.isReady("main")).toBe(true);
		expect(registry.get("main")).toBeDefined();
	});

	it("whenReady resolves immediately for sync clientFactory", async () => {
		const registry = new TokenSetAuthRegistry();
		registry.register(makeSyncEntry("main") as never);

		const service = await registry.whenReady("main");
		expect(service).toBeDefined();
		expect(registry.isReady("main")).toBe(true);
	});

	it("whenReady rejects for a key that was never registered", async () => {
		const registry = new TokenSetAuthRegistry();
		await expect(registry.whenReady("nonexistent")).rejects.toThrow();
	});

	it("metadata (urlPatterns) is available before async factory resolves", () => {
		const registry = new TokenSetAuthRegistry();
		registry.register(makeAsyncEntry("main", 100) as never);

		// Still initializing — but URL lookup works immediately
		expect(registry.readinessState("main")).toBe("initializing");
		expect(registry.clientKeyForUrl("/api/main/resource")).toBe("main");
	});
});

// ---------------------------------------------------------------------------
// 2. Interceptor — explicit not-yet-ready semantics
// ---------------------------------------------------------------------------

describe("createTokenSetBearerInterceptor — async client not-yet-ready semantics", () => {
	it("passes through without Authorization header when client is still initializing", async () => {
		const registry = new TokenSetAuthRegistry();
		// Async with long delay — still initializing when interceptor runs
		registry.register(makeAsyncEntry("main", 200) as never);

		const interceptor = createTokenSetBearerInterceptor(registry);
		let cloned = false;
		const req = {
			url: "/api/main/data",
			clone: (_u: { setHeaders?: Record<string, string> }) => {
				cloned = true;
				return req;
			},
		};
		const next = vi.fn().mockReturnValue(from([{}]));

		await firstValueFrom(interceptor(req, next) as ReturnType<typeof from>);

		// Explicit design: no Authorization header emitted — not-yet-ready passthrough
		expect(cloned).toBe(false);
		expect(next).toHaveBeenCalledWith(req);

		// Confirm it was indeed still initializing at call time
		// (registry transitions fully asynchronously so state is still "initializing" or "ready"
		//  depending on timing — but the key assertion is that no header was set)
		expect(registry.get("main")).toBeUndefined();
	});

	it("attaches Authorization header once client is ready and has a token", async () => {
		const registry = new TokenSetAuthRegistry();
		registry.register(makeAsyncEntry("main", 5, "ready-tok") as never);

		// Wait for client to materialize
		await registry.whenReady("main");
		expect(registry.isReady("main")).toBe(true);

		const interceptor = createTokenSetBearerInterceptor(registry);
		let capturedHeader: string | undefined;
		const req = {
			url: "/api/main/data",
			clone: (u: { setHeaders?: Record<string, string> }) => {
				capturedHeader = u.setHeaders?.Authorization;
				return { ...req, _cloned: true };
			},
		};
		const next = vi.fn().mockReturnValue(from([{}]));

		await firstValueFrom(interceptor(req, next) as ReturnType<typeof from>);
		expect(capturedHeader).toBe("Bearer ready-tok");
	});

	it("passes through without header for URL not matching any registered pattern (no fallback token)", async () => {
		const registry = new TokenSetAuthRegistry();
		// Client is ready but has no token (null state) — so even the fallback
		// registry.accessToken() returns null → no Authorization header
		registry.register(makeSyncEntry("main", null) as never);
		await registry.whenReady("main");

		const interceptor = createTokenSetBearerInterceptor(registry);
		const req = {
			url: "/unrelated/endpoint",
			clone: vi.fn(),
		};
		const next = vi.fn().mockReturnValue(from([{}]));
		await firstValueFrom(interceptor(req, next) as ReturnType<typeof from>);
		// No matching URL pattern + no fallback token → passthrough, no clone
		expect(req.clone).not.toHaveBeenCalled();
	});
});
