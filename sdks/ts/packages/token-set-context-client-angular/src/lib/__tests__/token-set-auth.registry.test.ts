import {
	createEventSubject,
	createReplaySignal,
	createSignal,
} from "@securitydept/client";
import {
	type AuthSnapshot,
	type TokenSetAuthEvent,
} from "@securitydept/token-set-context-client/orchestration";
import {
	ClientInitializationPriority,
	createTokenSetBearerInterceptor,
	type TokenSetAngularClient,
	TokenSetAuthRegistry,
} from "@securitydept/token-set-context-client-angular";
import { firstValueFrom, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

function expectReplayValue<T>(signal: {
	get(): { kind: "empty" } | { kind: "value"; value: T };
}): T {
	const slot = signal.get();
	expect(slot.kind).toBe("value");
	if (slot.kind !== "value") {
		throw new Error("Expected replay signal value.");
	}
	return slot.value;
}

function createAngularClient(
	name: string,
	authorizationHeader: string,
	disposeSpy: () => void = vi.fn<() => void>(() => undefined),
): TokenSetAngularClient {
	const authDetermined = createReplaySignal<true>();
	authDetermined.setValue(true);
	const authSnapshot = createReplaySignal<AuthSnapshot | null>();
	authSnapshot.setValue({
		tokens: { accessToken: `${name}-at` },
		metadata: {},
	});
	const isAuthenticated = createReplaySignal<boolean>();
	isAuthenticated.setValue(true);
	const authorizationHeaderValue = createReplaySignal<string | undefined>();
	authorizationHeaderValue.setValue(authorizationHeader);
	const lastAuthError = createSignal<unknown | undefined>(undefined);
	return {
		authDetermined,
		authSnapshot,
		isAuthenticated,
		authorizationHeaderValue,
		lastAuthError,
		authOperations: {
			restorePending: createSignal(false),
			refreshPending: createSignal(false),
			clearPending: createSignal(false),
			loginPending: createSignal(false),
		},
		authEvents: createEventSubject<TokenSetAuthEvent>(),
		addWorkflowSource: vi.fn(() => ({ unsubscribe: vi.fn() })),
		removeWorkflowSource: vi.fn(() => false),
		start: vi.fn(async () => undefined),
		dispose: disposeSpy,
		restorePersistedState: vi.fn(async () => null),
		handleCallback: vi.fn(async () => ({
			snapshot: { tokens: { accessToken: `${name}-at` }, metadata: {} },
			postAuthRedirectUri: "/after-login",
		})),
	};
}

describe("TokenSetAuthRegistry (Angular wrapper)", () => {
	it("bridges unregister/resetMaterialization/registered snapshots to the core lifecycle", async () => {
		const registry = new TokenSetAuthRegistry();
		const firstDispose = vi.fn();
		const secondDispose = vi.fn();
		const createdClients = [
			createAngularClient("first", "Bearer first", firstDispose),
			createAngularClient("second", "Bearer second", secondDispose),
		];
		const factory = vi
			.fn<() => TokenSetAngularClient>()
			.mockReturnValueOnce(createdClients[0])
			.mockReturnValueOnce(createdClients[1]);

		registry.register({
			key: "workspace",
			priority: ClientInitializationPriority.Lazy,
			clientFactory: factory,
			urlPatterns: ["https://api.example.com"],
			requirementKind: "workspace_oidc",
			providerFamily: "internal",
		});

		expect(registry.has("workspace")).toBe(true);
		expect(registry.registeredKeys()).toEqual(["workspace"]);
		expect(registry.readyKeys()).toEqual([]);

		const firstClient = await registry.whenReady("workspace");
		expect(expectReplayValue(firstClient.authorizationHeaderValue)).toBe(
			"Bearer first",
		);
		expect(registry.readyKeys()).toEqual(["workspace"]);

		expect(registry.resetMaterialization("workspace")).toBe(true);
		expect(firstDispose).toHaveBeenCalledTimes(1);
		expect(registry.has("workspace")).toBe(true);
		expect(registry.registeredKeys()).toEqual(["workspace"]);
		expect(registry.readyKeys()).toEqual([]);
		expect(registry.clientKeyListForRequirement("workspace_oidc")).toEqual([
			"workspace",
		]);

		const secondClient = await registry.whenReady("workspace");
		expect(secondClient).not.toBe(firstClient);
		expect(expectReplayValue(secondClient.authorizationHeaderValue)).toBe(
			"Bearer second",
		);
		expect(factory).toHaveBeenCalledTimes(2);

		expect(registry.unregister("workspace")).toBe(true);
		expect(secondDispose).toHaveBeenCalledTimes(1);
		expect(registry.unregister("workspace")).toBe(false);
		expect(registry.has("workspace")).toBe(false);
		expect(registry.registeredKeys()).toEqual([]);
		expect(registry.registeredEntriesSnapshot()).toEqual([]);
		expect(registry.registeredMetaSnapshot()).toEqual([]);
		registry.dispose();
	});

	it("interceptor does not use a stale service after unregister()", async () => {
		const registry = new TokenSetAuthRegistry();
		registry.register({
			key: "workspace",
			clientFactory: () => createAngularClient("workspace", "Bearer live"),
			urlPatterns: ["https://api.example.com"],
		});

		const interceptor = createTokenSetBearerInterceptor(registry, {
			strictUrlMatch: true,
		});
		const next = vi.fn((request: unknown) => of(request));
		const clone = vi.fn((update: { setHeaders?: Record<string, string> }) => ({
			url: "https://api.example.com/data",
			headers: update.setHeaders,
		}));

		const authorized = await firstValueFrom(
			interceptor(
				{
					url: "https://api.example.com/data",
					clone,
				},
				next,
			),
		);
		expect(clone).toHaveBeenCalledWith({
			setHeaders: { Authorization: "Bearer live" },
		});
		expect(authorized).toMatchObject({
			headers: { Authorization: "Bearer live" },
		});

		registry.unregister("workspace");
		clone.mockClear();
		next.mockClear();

		const originalRequest = {
			url: "https://api.example.com/data",
			clone,
		};
		const result = await firstValueFrom(interceptor(originalRequest, next));
		expect(clone).not.toHaveBeenCalled();
		expect(next).toHaveBeenCalledWith(originalRequest);
		expect(result).toBe(originalRequest);
		registry.dispose();
	});
});
