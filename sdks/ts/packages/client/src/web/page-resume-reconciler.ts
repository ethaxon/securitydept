// Page resume reconciler — browser lifecycle hardening primitive.

export const PageResumeTriggerKind = {
	Visibility: "visibility",
	PageShow: "pageshow",
	Focus: "focus",
	Online: "online",
} as const;

export type PageResumeTriggerKind =
	(typeof PageResumeTriggerKind)[keyof typeof PageResumeTriggerKind];

export interface PageResumeEvent {
	trigger: PageResumeTriggerKind;
	persisted?: boolean;
}

export type PageResumeCallback = (
	event: PageResumeEvent,
) => void | Promise<void>;

export interface PageResumeDocumentTarget {
	addEventListener(type: "visibilitychange", handler: EventListener): void;
	removeEventListener(type: "visibilitychange", handler: EventListener): void;
	visibilityState: DocumentVisibilityState;
}

export interface PageResumeWindowTarget {
	addEventListener(
		type: "pageshow" | "focus" | "online",
		handler: EventListener,
	): void;
	removeEventListener(
		type: "pageshow" | "focus" | "online",
		handler: EventListener,
	): void;
}

export interface CreatePageResumeReconcilerOptions {
	onReconcile: PageResumeCallback;
	/** Defaults to 5000ms. Use 0 in deterministic tests. */
	throttleMs?: number;
	document?: PageResumeDocumentTarget | null;
	window?: PageResumeWindowTarget | null;
	now?: () => number;
	onError?: (error: unknown, event: PageResumeEvent) => void;
}

export interface PageResumeReconciler {
	dispose(): void;
	readonly reconcileCount: number;
}

type Cleanup = () => void;

export function createPageResumeReconciler(
	options: CreatePageResumeReconcilerOptions,
): PageResumeReconciler {
	const throttleMs = options.throttleMs ?? 5000;
	const getNow = options.now ?? (() => Date.now());
	const doc = options.document ?? maybeDocument();
	const win = options.window ?? maybeWindow();

	let previousVisibilityState: DocumentVisibilityState =
		doc?.visibilityState ?? "visible";
	let lastReconcileAt = 0;
	let reconcileCount = 0;
	let disposed = false;
	const cleanups: Cleanup[] = [];

	const reconcile = (event: PageResumeEvent): void => {
		if (disposed) return;
		const now = getNow();
		if (now - lastReconcileAt < throttleMs) return;

		lastReconcileAt = now;
		reconcileCount += 1;
		try {
			const result = options.onReconcile(event);
			if (isPromiseLike(result)) {
				result.catch((error) => options.onError?.(error, event));
			}
		} catch (error) {
			options.onError?.(error, event);
		}
	};

	if (doc) {
		const handler: EventListener = () => {
			const nextVisibilityState = doc.visibilityState;
			if (
				nextVisibilityState === "visible" &&
				previousVisibilityState !== "visible"
			) {
				reconcile({ trigger: PageResumeTriggerKind.Visibility });
			}
			previousVisibilityState = nextVisibilityState;
		};
		doc.addEventListener("visibilitychange", handler);
		cleanups.push(() => doc.removeEventListener("visibilitychange", handler));
	}

	if (win) {
		const pageshowHandler: EventListener = (event) => {
			reconcile({
				trigger: PageResumeTriggerKind.PageShow,
				persisted: Boolean((event as PageTransitionEvent).persisted),
			});
		};
		const focusHandler: EventListener = () => {
			reconcile({ trigger: PageResumeTriggerKind.Focus });
		};
		const onlineHandler: EventListener = () => {
			reconcile({ trigger: PageResumeTriggerKind.Online });
		};

		win.addEventListener("pageshow", pageshowHandler);
		win.addEventListener("focus", focusHandler);
		win.addEventListener("online", onlineHandler);
		cleanups.push(() => win.removeEventListener("pageshow", pageshowHandler));
		cleanups.push(() => win.removeEventListener("focus", focusHandler));
		cleanups.push(() => win.removeEventListener("online", onlineHandler));
	}

	return {
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const cleanup of cleanups.splice(0)) {
				cleanup();
			}
		},
		get reconcileCount() {
			return reconcileCount;
		},
	};
}

function maybeDocument(): PageResumeDocumentTarget | null {
	const documentTarget = globalThis.document;
	return isPageResumeDocumentTarget(documentTarget) ? documentTarget : null;
}

function maybeWindow(): PageResumeWindowTarget | null {
	const windowTarget = globalThis.window;
	return isPageResumeWindowTarget(windowTarget) ? windowTarget : null;
}

function isPageResumeDocumentTarget(
	value: unknown,
): value is PageResumeDocumentTarget {
	return (
		typeof value === "object" &&
		value !== null &&
		"visibilityState" in value &&
		typeof (value as { addEventListener?: unknown }).addEventListener ===
			"function" &&
		typeof (value as { removeEventListener?: unknown }).removeEventListener ===
			"function"
	);
}

function isPageResumeWindowTarget(
	value: unknown,
): value is PageResumeWindowTarget {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { addEventListener?: unknown }).addEventListener ===
			"function" &&
		typeof (value as { removeEventListener?: unknown }).removeEventListener ===
			"function"
	);
}

function isPromiseLike(value: unknown): value is PromiseLike<void> {
	return (
		typeof value === "object" &&
		value !== null &&
		"then" in value &&
		typeof (value as { then?: unknown }).then === "function"
	);
}
