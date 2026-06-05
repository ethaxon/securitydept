import {
	createEventSubject,
	createSignal,
	type ResourceSnapshot,
	ResourceStatus,
	type TimeTrait,
} from "@securitydept/client";
import {
	createPageResumeSource,
	PageResumeTriggerKind,
} from "@securitydept/client/web";
import { describe, expect, it, vi } from "vitest";
import {
	TokenSetPageResumeWorkflowSource,
	TokenSetPageResumeWorkflowSourceTraceEventType,
} from "../client/workflows/source/page-resume";
import {
	TokenSetRefreshTimerWorkflowSource,
	TokenSetRefreshTimerWorkflowSourceTraceEventType,
} from "../client/workflows/source/refresh-timer";
import { type TokenSetAuthSnapshot } from "../token/types";

function createMockDocument(initialState: DocumentVisibilityState = "hidden") {
	let handler: EventListener | undefined;
	let visibilityState = initialState;
	const addEventListener = vi.fn(
		(_type: "visibilitychange", nextHandler: EventListener) => {
			handler = nextHandler;
		},
	);
	const removeEventListener = vi.fn(
		(_type: "visibilitychange", nextHandler: EventListener) => {
			if (handler === nextHandler) {
				handler = undefined;
			}
		},
	);

	return {
		addEventListener,
		removeEventListener,
		get visibilityState() {
			return visibilityState;
		},
		simulateChange(state: DocumentVisibilityState) {
			visibilityState = state;
			handler?.(new Event("visibilitychange"));
		},
	};
}

function createAuthSnapshot(
	accessToken: string,
	options?: {
		expiresAt?: string;
		refreshMaterial?: string;
	},
): TokenSetAuthSnapshot {
	return {
		tokens: {
			accessToken,
			accessTokenIssuedAt: new Date(Date.now() - 60_000).toISOString(),
			accessTokenExpiresAt:
				options?.expiresAt ?? new Date(Date.now() + 10 * 60_000).toISOString(),
			refreshMaterial: options?.refreshMaterial ?? "refresh-token",
		},
		metadata: {},
	};
}

function createStaticTime(now: number): TimeTrait {
	return {
		now: () => now,
		setTimeout: globalThis.setTimeout.bind(globalThis),
		clearTimeout: globalThis.clearTimeout.bind(globalThis),
	};
}

describe("token-set workflow sources", () => {
	it("does not implicitly read global document/window targets", () => {
		const time = createStaticTime(10_000);
		const originalDocument = Object.getOwnPropertyDescriptor(
			globalThis,
			"document",
		);
		const originalWindow = Object.getOwnPropertyDescriptor(
			globalThis,
			"window",
		);
		const documentTarget = createMockDocument("hidden");
		Object.defineProperty(globalThis, "document", {
			value: documentTarget,
			configurable: true,
		});
		Object.defineProperty(globalThis, "window", {
			value: {},
			configurable: true,
		});

		try {
			const source = TokenSetPageResumeWorkflowSource.fromBuiltin(
				{
					pageLifecycle: undefined,
					time,
				},
				undefined,
			);
			const events: unknown[] = [];
			const subscription = source.eventStream.subscribe({
				next: (event) => events.push(event),
			});

			documentTarget.simulateChange("visible");

			expect(events).toEqual([]);
			expect(documentTarget.addEventListener).not.toHaveBeenCalled();

			subscription.unsubscribe();
		} finally {
			restoreGlobalProperty("document", originalDocument);
			restoreGlobalProperty("window", originalWindow);
		}
	});

	it("records page-resume source traces with local attributes", () => {
		const time = createStaticTime(10_000);
		const documentTarget = createMockDocument("hidden");
		const resume = createPageResumeSource({
			documentTarget,
			windowTarget: null,
		});
		const pageLifecycle = {
			resume,
		};
		const traceEvents: Array<{
			type: string;
			attributes?: Record<string, unknown>;
		}> = [];
		const source = TokenSetPageResumeWorkflowSource.fromBuiltin(
			{
				pageLifecycle,
				time,
				recordTrace: (type, attributes) => {
					traceEvents.push({ type, attributes });
				},
			},
			{
				kind: "bundle",
				options: { throttleMs: 0 },
			},
		);
		const subscription = source.eventStream.subscribe({ next: () => {} });

		documentTarget.simulateChange("visible");

		expect(traceEvents).toEqual([
			{
				type: TokenSetPageResumeWorkflowSourceTraceEventType.Fired,
				attributes: {
					trigger: PageResumeTriggerKind.Visibility,
					persisted: undefined,
				},
			},
		]);

		subscription.unsubscribe();
	});

	it("records scheduled refresh-timer traces without elevating a global source enum", () => {
		const time = createStaticTime(10_000);
		const authSnapshot = createSignal<
			ResourceSnapshot<TokenSetAuthSnapshot | null>
		>({ status: ResourceStatus.Idle });
		const traceEvents: Array<{
			type: string;
			attributes?: Record<string, unknown>;
		}> = [];
		const source = TokenSetRefreshTimerWorkflowSource.fromBuiltin(
			{
				time,
				freshnessOptions: {
					clockSkewMs: 0,
					refreshWindowMs: 60_000,
				},
				authSnapshot,
				recordTrace: (type, attributes) => {
					traceEvents.push({ type, attributes });
				},
			},
			{
				kind: "bundle",
				options: { maxScheduleSliceMs: 30_000 },
			},
		);
		const subscription = source.eventStream.subscribe({ next: () => {} });

		authSnapshot.set({
			status: ResourceStatus.Resolved,
			value: createAuthSnapshot("future-token", {
				expiresAt: new Date(10_000 + 5 * 60_000).toISOString(),
			}),
		});

		expect(traceEvents[0]).toEqual({
			type: TokenSetRefreshTimerWorkflowSourceTraceEventType.Scheduled,
			attributes: expect.objectContaining({
				triggerKind: "slice",
				freshnessState: "fresh",
				delayMs: 30_000,
			}),
		});

		subscription.unsubscribe();
	});

	it("records fired refresh-timer traces when refresh is immediately due", () => {
		const time = createStaticTime(10_000);
		const authSnapshot = createSignal<
			ResourceSnapshot<TokenSetAuthSnapshot | null>
		>({ status: ResourceStatus.Idle });
		const traceEvents: Array<{
			type: string;
			attributes?: Record<string, unknown>;
		}> = [];
		const source = TokenSetRefreshTimerWorkflowSource.fromBuiltin(
			{
				time,
				freshnessOptions: {
					clockSkewMs: 0,
					refreshWindowMs: 60_000,
				},
				authSnapshot,
				recordTrace: (type, attributes) => {
					traceEvents.push({ type, attributes });
				},
			},
			undefined,
		);
		const events: unknown[] = [];
		const subscription = source.eventStream.subscribe({
			next: (event) => events.push(event),
		});

		authSnapshot.set({
			status: ResourceStatus.Resolved,
			value: createAuthSnapshot("expired-token", {
				expiresAt: new Date(10_000 - 1_000).toISOString(),
			}),
		});

		expect(events).toHaveLength(1);
		expect(traceEvents).toEqual([
			{
				type: TokenSetRefreshTimerWorkflowSourceTraceEventType.Fired,
				attributes: expect.objectContaining({
					triggerKind: "immediate",
					freshnessState: "expired",
					delayMs: 0,
				}),
			},
		]);

		subscription.unsubscribe();
	});

	it("can emit page-resume events from explicit page lifecycle input", () => {
		const time = createStaticTime(10_000);
		const resume = createEventSubject<{
			trigger: "focus";
		}>();
		const source = TokenSetPageResumeWorkflowSource.fromBuiltin(
			{
				pageLifecycle: {
					resume,
				},
				time,
			},
			{
				kind: "bundle",
				options: { throttleMs: 0 },
			},
		);
		const events: unknown[] = [];
		const subscription = source.eventStream.subscribe({
			next: (event) => events.push(event),
		});

		resume.next({ trigger: "focus" });

		expect(events).toEqual([{ trigger: "focus" }]);
		subscription.unsubscribe();
	});
});

function restoreGlobalProperty(
	key: "document" | "window",
	descriptor: PropertyDescriptor | undefined,
): void {
	if (descriptor) {
		Object.defineProperty(globalThis, key, descriptor);
		return;
	}
	delete (globalThis as Record<string, unknown>)[key];
}
