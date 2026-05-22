import type {
	EventStreamTrait,
	EventSubscriptionTrait,
	Subscription,
} from "@securitydept/client";
import { createEventStream, fromEventPattern } from "@securitydept/client";
import type {
	PageResumeDocumentTarget,
	PageResumeEvent,
	PageResumeWindowTarget,
} from "@securitydept/client/web";
import { PageResumeTriggerKind } from "@securitydept/client/web";
import { TokenSetAuthFlowSource } from "../events/auth-events";

const DEFAULT_PAGE_RESUME_THROTTLE_MS = 5000;
const TOKEN_SET_PAGE_RESUME_AUTH_CHECK_ATTACHED = Symbol(
	"token-set-page-resume-auth-check-attached",
);

export interface TokenSetAuthCheckTriggerEvent {
	source: TokenSetAuthFlowSource;
	reason: "restore_completed" | "refresh_timer" | "page_resume" | string;
	forceRefreshWhenDue?: boolean;
	clearStateWhenUnauthenticated?: boolean;
	scheduleRefreshAfterAuthenticated?: boolean;
	allowBackgroundRefresh?: boolean;
	clockSkewMs?: number;
	refreshWindowMs?: number;
}

export type TokenSetAuthCheckTriggerSource =
	EventStreamTrait<TokenSetAuthCheckTriggerEvent>;

export interface PageResumeAuthCheckOptions {
	/** Defaults to 5000ms. Use 0 in deterministic tests. */
	throttleMs?: number;
	document?: PageResumeDocumentTarget | null;
	window?: PageResumeWindowTarget | null;
	now?: () => number;
	clockSkewMs?: number;
	refreshWindowMs?: number;
	onTriggerSkipped?: (event: PageResumeEvent) => void;
}

export interface AttachPageResumeAuthCheckTriggerSourceOptions {
	pageResumeAuthCheck?: boolean;
	pageResumeAuthCheckOptions?: PageResumeAuthCheckOptions;
	authCheckTriggerSources?: readonly TokenSetAuthCheckTriggerSource[];
}

export interface TokenSetAuthCheckTriggerClient {
	addAuthCheckTriggerSource(
		source: TokenSetAuthCheckTriggerSource,
	): EventSubscriptionTrait;
}

export function createPageResumeAuthCheckTriggerSource(
	options: PageResumeAuthCheckOptions = {},
): TokenSetAuthCheckTriggerSource {
	const throttleMs = options.throttleMs ?? DEFAULT_PAGE_RESUME_THROTTLE_MS;
	const getNow = options.now ?? (() => Date.now());

	return createEventStream<TokenSetAuthCheckTriggerEvent>((observer) => {
		const documentTarget = options.document ?? maybeDocument();
		const windowTarget = options.window ?? maybeWindow();
		const subscriptions: Subscription[] = [];

		let previousVisibilityState: DocumentVisibilityState =
			documentTarget?.visibilityState ?? "visible";
		let lastTriggerAt = 0;

		const emitTrigger = (event: PageResumeEvent): void => {
			const now = getNow();
			if (now - lastTriggerAt < throttleMs) {
				options.onTriggerSkipped?.(event);
				return;
			}
			lastTriggerAt = now;
			observer.next?.({
				source: TokenSetAuthFlowSource.Resume,
				reason: "page_resume",
				forceRefreshWhenDue: true,
				clearStateWhenUnauthenticated: false,
				clockSkewMs: options.clockSkewMs,
				refreshWindowMs: options.refreshWindowMs,
			});
		};

		if (documentTarget) {
			subscriptions.push(
				fromEventPattern<Event>({
					addHandler: (handler) =>
						documentTarget.addEventListener("visibilitychange", handler),
					removeHandler: (handler) =>
						documentTarget.removeEventListener("visibilitychange", handler),
					callback: () => {
						const nextVisibilityState = documentTarget.visibilityState;
						if (
							nextVisibilityState === "visible" &&
							previousVisibilityState !== "visible"
						) {
							emitTrigger({ trigger: PageResumeTriggerKind.Visibility });
						}
						previousVisibilityState = nextVisibilityState;
					},
				}),
			);
		}

		if (windowTarget) {
			subscriptions.push(
				fromEventPattern<Event>({
					addHandler: (handler) =>
						windowTarget.addEventListener("pageshow", handler),
					removeHandler: (handler) =>
						windowTarget.removeEventListener("pageshow", handler),
					callback: (event) =>
						emitTrigger({
							trigger: PageResumeTriggerKind.PageShow,
							persisted: Boolean((event as PageTransitionEvent).persisted),
						}),
				}),
			);
			subscriptions.push(
				fromEventPattern<Event>({
					addHandler: (handler) =>
						windowTarget.addEventListener("focus", handler),
					removeHandler: (handler) =>
						windowTarget.removeEventListener("focus", handler),
					callback: () => emitTrigger({ trigger: PageResumeTriggerKind.Focus }),
				}),
			);
			subscriptions.push(
				fromEventPattern<Event>({
					addHandler: (handler) =>
						windowTarget.addEventListener("online", handler),
					removeHandler: (handler) =>
						windowTarget.removeEventListener("online", handler),
					callback: () =>
						emitTrigger({ trigger: PageResumeTriggerKind.Online }),
				}),
			);
		}

		return () => {
			for (const subscription of subscriptions.splice(0)) {
				subscription.unsubscribe();
			}
		};
	});
}

export function attachPageResumeAuthCheckTriggerSource<
	TClient extends TokenSetAuthCheckTriggerClient,
>(
	client: TClient,
	options: AttachPageResumeAuthCheckTriggerSourceOptions = {},
): TClient {
	const attachedClient = client as TClient & {
		[TOKEN_SET_PAGE_RESUME_AUTH_CHECK_ATTACHED]?: true;
	};
	if (attachedClient[TOKEN_SET_PAGE_RESUME_AUTH_CHECK_ATTACHED] !== true) {
		Object.defineProperty(
			attachedClient,
			TOKEN_SET_PAGE_RESUME_AUTH_CHECK_ATTACHED,
			{
				value: true,
				configurable: false,
				enumerable: false,
				writable: false,
			},
		);
		if (options.pageResumeAuthCheck !== false) {
			client.addAuthCheckTriggerSource(
				createPageResumeAuthCheckTriggerSource(
					options.pageResumeAuthCheckOptions,
				),
			);
		}
	}

	for (const source of options.authCheckTriggerSources ?? []) {
		client.addAuthCheckTriggerSource(source);
	}

	return client;
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
