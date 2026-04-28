import type { ReadableSignalTrait } from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import {
	attachTokenSetResumeReconciliation,
	createTokenSetResumeReconciler,
	shouldReconcileTokenSetSnapshot,
} from "../resume-reconciliation";
import type { AuthSnapshot } from "../types";

function createSnapshot(options: {
	accessTokenExpiresAt: number;
	refreshMaterial?: string;
}): AuthSnapshot {
	return {
		tokens: {
			accessToken: "access-token",
			accessTokenExpiresAt: new Date(
				options.accessTokenExpiresAt,
			).toISOString(),
			refreshMaterial: options.refreshMaterial,
		},
		metadata: {},
	};
}

function createSignal(
	snapshot: AuthSnapshot | null,
): ReadableSignalTrait<AuthSnapshot | null> {
	return {
		get: () => snapshot,
		subscribe: () => () => {},
	};
}

function createMockDocument(initialState: DocumentVisibilityState = "hidden") {
	let handler: EventListener | undefined;
	let visibilityState = initialState;
	const addEventListener = vi.fn(
		(_type: "visibilitychange", nextHandler: EventListener) => {
			handler = nextHandler;
		},
	);

	return {
		addEventListener,
		removeEventListener: vi.fn(),
		get visibilityState() {
			return visibilityState;
		},
		simulateChange(state: DocumentVisibilityState) {
			visibilityState = state;
			handler?.(new Event("visibilitychange"));
		},
	};
}

function createMockWindow() {
	return {
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	};
}

describe("token-set resume reconciliation", () => {
	it("reconciles refresh-due token sets by forcing freshness", async () => {
		const snapshot = createSnapshot({
			accessTokenExpiresAt: Date.now() + 30_000,
			refreshMaterial: "refresh-token",
		});
		const doc = createMockDocument("hidden");
		const ensureAuthForResource = vi.fn().mockResolvedValue({ snapshot });

		createTokenSetResumeReconciler(
			{
				state: createSignal(snapshot),
				ensureAuthForResource,
				dispose: vi.fn(),
			},
			{
				document: doc,
				window: null,
				throttleMs: 0,
				now: () => 10_000,
			},
		);

		doc.simulateChange("visible");
		await Promise.resolve();

		expect(ensureAuthForResource).toHaveBeenCalledWith({
			source: "resume",
			forceRefreshWhenDue: true,
			clockSkewMs: undefined,
			refreshWindowMs: undefined,
			clearStateWhenUnauthenticated: false,
		});
	});

	it("skips snapshots without refresh material", async () => {
		const snapshot = createSnapshot({
			accessTokenExpiresAt: Date.now() - 1_000,
		});
		const doc = createMockDocument("hidden");
		const ensureAuthForResource = vi.fn().mockResolvedValue({ snapshot });
		const onReconcileSkipped = vi.fn();

		createTokenSetResumeReconciler(
			{
				state: createSignal(snapshot),
				ensureAuthForResource,
				dispose: vi.fn(),
			},
			{
				document: doc,
				window: null,
				throttleMs: 0,
				onReconcileSkipped,
			},
		);

		doc.simulateChange("visible");
		await Promise.resolve();

		expect(ensureAuthForResource).toHaveBeenCalledTimes(1);
		expect(onReconcileSkipped).toHaveBeenCalledTimes(1);
	});

	it("disposes the resume reconciler with the attached client", () => {
		const snapshot = createSnapshot({
			accessTokenExpiresAt: Date.now() + 30_000,
			refreshMaterial: "refresh-token",
		});
		const doc = createMockDocument("hidden");
		const client = {
			state: createSignal(snapshot),
			ensureAuthForResource: vi.fn().mockResolvedValue({ snapshot }),
			dispose: vi.fn(),
		};

		attachTokenSetResumeReconciliation(client, {
			resumeReconciliationOptions: {
				document: doc,
				window: null,
				throttleMs: 0,
			},
		});

		client.dispose();
		doc.simulateChange("visible");

		expect(doc.removeEventListener).toHaveBeenCalledTimes(1);
		expect(client.ensureAuthForResource).not.toHaveBeenCalled();
	});

	it("attaches only once when a client is already wrapped", () => {
		const snapshot = createSnapshot({
			accessTokenExpiresAt: Date.now() + 30_000,
			refreshMaterial: "refresh-token",
		});
		const doc = createMockDocument("hidden");
		const win = createMockWindow();
		const client = {
			state: createSignal(snapshot),
			ensureAuthForResource: vi.fn().mockResolvedValue({ snapshot }),
			dispose: vi.fn(),
		};

		attachTokenSetResumeReconciliation(client, {
			resumeReconciliationOptions: {
				document: doc,
				window: win,
				throttleMs: 0,
			},
		});
		attachTokenSetResumeReconciliation(client, {
			resumeReconciliationOptions: {
				document: doc,
				window: win,
				throttleMs: 0,
			},
		});

		expect(doc.addEventListener).toHaveBeenCalledTimes(1);
		expect(win.addEventListener).toHaveBeenCalledTimes(3);
	});

	it("recognizes only refreshable expired or refresh-due snapshots", () => {
		expect(
			shouldReconcileTokenSetSnapshot(
				createSnapshot({
					accessTokenExpiresAt: Date.now() + 30_000,
					refreshMaterial: "refresh-token",
				}),
			),
		).toBe(true);
		expect(
			shouldReconcileTokenSetSnapshot(
				createSnapshot({
					accessTokenExpiresAt: Date.now() + 120_000,
					refreshMaterial: "refresh-token",
				}),
			),
		).toBe(false);
		expect(
			shouldReconcileTokenSetSnapshot(
				createSnapshot({ accessTokenExpiresAt: Date.now() - 1_000 }),
			),
		).toBe(false);
	});
});
