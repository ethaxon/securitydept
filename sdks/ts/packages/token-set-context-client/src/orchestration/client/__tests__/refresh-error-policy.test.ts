import {
	ClientError,
	ClientErrorKind,
	createCancellationTokenSource,
	createEventSubject,
	createInMemoryRecordStore,
	type FoundationEnvironment,
	type StorageTrait,
} from "@securitydept/client";
import {
	createEnvironmentForTest,
	createTimeForTest,
} from "@securitydept/client/test";
import { type PageResumeEvent } from "@securitydept/client/web";
import { from } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { type TokenSetAuthSnapshot } from "../../token/types";
import { BaseOidcModeClient, PersistPolicy } from "../base-client";
import { TokenSetAuthorizationRevocationError } from "../error";
import {
	type TokenSetRefreshErrorContext,
	type TokenSetRefreshErrorPolicy,
} from "../types";

const snapshot: TokenSetAuthSnapshot = {
	tokens: {
		accessToken: "expired",
		refreshMaterial: "revoked",
		accessTokenExpiresAt: "2020-01-01T00:00:00Z",
	},
	metadata: {},
};
const revoked = () =>
	new TokenSetAuthorizationRevocationError({ reason: "invalid_grant" });

class PolicyClient extends BaseOidcModeClient {
	readonly refresh = vi.fn(async (): Promise<never> => {
		throw revoked();
	});
	readonly loginWithRedirect = vi.fn(async () => {});
	async loginWithPopup(): Promise<never> {
		throw new Error("Not used");
	}
	constructor(
		environment: FoundationEnvironment,
		store: StorageTrait,
		policy?: TokenSetRefreshErrorPolicy,
		timer = false,
	) {
		super({
			environment,
			persistence: { store, key: "auth" },
			refreshErrorPolicy: policy,
			tracing: { target: "policy-test", prefix: "policy-test" },
			refresh: {
				tokenFreshness: { clockSkewMs: 0, refreshWindowMs: 0 },
				sources: { refreshTimer: timer ? undefined : false },
			},
		});
	}
	protected async _refreshAuthSnapshot() {
		return this.refresh();
	}
}

function setup(policy?: TokenSetRefreshErrorPolicy) {
	const store = createInMemoryRecordStore();
	const environment = createEnvironmentForTest({ persistentStorage: store });
	return { store, client: new PolicyClient(environment, store, policy) };
}
async function persist(store: StorageTrait) {
	await store.set(
		"auth",
		JSON.stringify({ version: 1, storedAt: Date.now(), value: snapshot }),
	);
}

describe("refresh error policy", () => {
	it.each([
		"invalid_grant",
		"invalid_token",
	] as const)("recovers confirmed %s and keeps diagnostics", async (reason) => {
		const { client: owned, store } = setup();
		using client = owned;
		const error = new TokenSetAuthorizationRevocationError({ reason });
		client.refresh.mockRejectedValue(error);
		await client.restoreState(snapshot, {
			persistPolicy: PersistPolicy.FollowClient,
		});
		const events: string[] = [];
		const failures: unknown[] = [];
		from(client.authEvents).subscribe((event) => {
			events.push(event.type);
			if ("error" in event.payload) {
				failures.push(event.payload.error);
			}
		});
		await expect(client.refreshState()).resolves.toBeNull();
		expect(client.authSnapshot.get()).toEqual({
			status: "resolved",
			value: null,
		});
		expect(await client.isAuthenticated.whenValue()).toBe(false);
		expect(await client.authorizationHeaderValue.whenValue()).toBeUndefined();
		expect(await store.get("auth")).toBeNull();
		expect(
			events.filter((type) => type === "auth.unauthenticated"),
		).toHaveLength(1);
		expect(failures).toContain(error);
	});

	it.each([
		undefined,
		"revokeAsUnauthenticatedOnInit",
	] as const)("recovers startup using %s", async (policy) => {
		const { client: owned, store } = setup(policy);
		using client = owned;
		await persist(store);
		await expect(client.start()).resolves.toBeNull();
		expect(await client.isAuthenticated.whenValue()).toBe(false);
		expect(await store.get("auth")).toBeNull();
	});

	it.each([
		"throw",
		"revokeAsUnauthenticatedOnInit",
	] as const)("retains manual error semantics using %s", async (policy) => {
		const { client: owned, store } = setup(policy);
		using client = owned;
		await persist(store);
		await expect(client.restorePersistedState()).rejects.toBeInstanceOf(
			TokenSetAuthorizationRevocationError,
		);
		expect(client.authSnapshot.get()).toMatchObject({
			status: "error",
			value: null,
		});
		expect(await store.get("auth")).toBeNull();
	});

	it("allows strict startup failure", async () => {
		const { client: owned, store } = setup("throw");
		using client = owned;
		await persist(store);
		await expect(client.start()).rejects.toBeInstanceOf(
			TokenSetAuthorizationRevocationError,
		);
		expect(await store.get("auth")).toBeNull();
	});

	it.each([
		false,
		true,
	])("passes operation-local context to a custom handler (async=%s)", async (asynchronous) => {
		const contexts: TokenSetRefreshErrorContext[] = [];
		const { client: owned, store } = setup((context) => {
			contexts.push(context);
			return asynchronous
				? Promise.resolve("unauthenticated")
				: "unauthenticated";
		});
		using client = owned;
		await persist(store);
		await client.start();
		await persist(store);
		await client.restorePersistedState();
		await client.restoreState(snapshot);
		await client.refreshState();
		expect(
			contexts.map(({ operation, trigger }) => ({ operation, trigger })),
		).toEqual([
			{ operation: "restorePersistedState", trigger: "initialization" },
			{ operation: "restorePersistedState", trigger: "manual" },
			{ operation: "refresh", trigger: "manual" },
		]);
		expect(contexts.every((context) => context.clientId === client.id)).toBe(
			true,
		);
	});

	it.each([
		"default",
		"custom",
	])("does not recover unclassified errors with %s policy", async (policy) => {
		const { client: owned, store } = setup(
			policy === "custom" ? () => "unauthenticated" : undefined,
		);
		using client = owned;
		const error = new ClientError({
			kind: ClientErrorKind.Server,
			message: "401 or network failure, token revoked",
		});
		client.refresh.mockRejectedValue(error);
		await persist(store);
		const before = await store.get("auth");
		await expect(client.restorePersistedState()).rejects.toBe(error);
		expect(await store.get("auth")).toBe(before);
		expect(client.authSnapshot.get()).toMatchObject({
			status: "error",
			value: snapshot,
		});
	});

	it.each([
		"throw",
		"invalid",
		"cancel",
	] as const)("clears revoked material when handler outcome is %s", async (outcome) => {
		const cancellation = createCancellationTokenSource();
		const failure = new Error("Handler failure");
		const entered = Promise.withResolvers<void>();
		const { client: owned, store } = setup(() => {
			entered.resolve();
			if (outcome === "throw") {
				throw failure;
			}
			if (outcome === "invalid") {
				return "invalid" as never;
			}
			return new Promise<never>(() => {});
		});
		using client = owned;
		await client.restoreState(snapshot, {
			persistPolicy: PersistPolicy.FollowClient,
		});
		const action = client.refreshState({
			cancellationToken: cancellation.token,
		});
		const rejected = expect(action).rejects.toBeDefined();
		await entered.promise;
		if (outcome === "cancel") {
			cancellation.cancel();
		}
		await rejected;
		expect(await store.get("auth")).toBeNull();
		expect(client.authSnapshot.get()).toMatchObject({
			status: "error",
			value: null,
		});
	});

	it.each([
		"refreshTimer",
		"pageResume",
	] as const)("carries %s trigger through background refresh", async (trigger) => {
		const time = createTimeForTest({ initialNow: Date.now() });
		const resume = createEventSubject<PageResumeEvent>();
		const store = createInMemoryRecordStore();
		const environment = createEnvironmentForTest({
			time,
			persistentStorage: store,
			pageLifecycle: { resume },
		});
		const handler = vi.fn(() => "unauthenticated" as const);
		using client = new PolicyClient(
			environment,
			store,
			handler,
			trigger === "refreshTimer",
		);
		await client.restoreState({
			...snapshot,
			tokens: {
				...snapshot.tokens,
				accessTokenExpiresAt: new Date(time.now() + 10_000).toISOString(),
			},
		});
		time.advanceAndFlush(10_001);
		if (trigger === "pageResume") {
			resume.next({ trigger: "focus" });
		}
		await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
		expect(handler).toHaveBeenCalledWith(
			expect.objectContaining({ operation: "refresh", trigger }),
		);
		await vi.waitFor(() =>
			expect(client.authSnapshot.get()).toEqual({
				status: "resolved",
				value: null,
			}),
		);
	});
});
