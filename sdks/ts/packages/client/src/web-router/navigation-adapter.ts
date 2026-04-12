// Navigation adapter — abstraction over Web Navigation API / History API
//
// Canonical subpath: @securitydept/client/web-router
//
// The Web Navigation API (window.navigation) is the modern, cleaner
// primitive for client-side routing (pre-commit intercept, typed intents,
// rollback support). Where available (Chromium ≥ 102), we prefer it.
// Otherwise we fall back to the classic History API + popstate + link
// click capture, which every browser still supports.
//
// Both adapters implement the same `NavigationAdapter` contract so the
// higher-level `createWebRouter` factory does not need to branch on which
// backend is active — tests can also target either path deterministically.
//
// Stability: provisional (new in iteration 110)

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export const NavigationAdapterKind = {
	NavigationApi: "navigation-api",
	History: "history",
} as const;
export type NavigationAdapterKind =
	(typeof NavigationAdapterKind)[keyof typeof NavigationAdapterKind];

export const NavigationCause = {
	Initial: "initial",
	Push: "push",
	Replace: "replace",
	Traverse: "traverse",
} as const;
export type NavigationCause =
	(typeof NavigationCause)[keyof typeof NavigationCause];

export interface NavigationIntent {
	readonly url: URL;
	readonly cause: NavigationCause;
	readonly replace: boolean;
	readonly state: unknown;
	/** Abort this navigation before it commits. */
	preventDefault(): void;
	/** Cancel the current intent and navigate to the given URL instead. */
	redirect(url: string | URL, options?: { replace?: boolean }): void;
}

export interface NavigationCommit {
	readonly url: URL;
}

export interface NavigateOptions {
	/** When true, replace the current history entry instead of pushing. */
	replace?: boolean;
	/** Serializable state to attach to the history entry. */
	state?: unknown;
	/**
	 * Arbitrary per-navigation metadata. Passed through to `NavigateEvent.info`
	 * when the Navigation API adapter is active; ignored by the History
	 * adapter (no wire support).
	 */
	info?: unknown;
}

export interface NavigationAdapter {
	readonly kind: NavigationAdapterKind;
	currentUrl(): URL;
	navigate(url: string | URL, options?: NavigateOptions): Promise<void>;
	back(): void;
	forward(): void;
	/**
	 * Called *before* a navigation commits, so listeners can cancel or
	 * redirect. Both adapters forward synchronous and asynchronous handlers
	 * (adapters await the intent being fully processed before committing).
	 */
	onBeforeNavigate(
		listener: (intent: NavigationIntent) => void | Promise<void>,
	): () => void;
	/** Called *after* a navigation commits. */
	onNavigate(listener: (commit: NavigationCommit) => void): () => void;
	destroy(): void;
}

// ---------------------------------------------------------------------------
// Navigation API typings (reduced; TS DOM libs cover this but the types are
// still experimental in some TypeScript versions, so we mirror the minimal
// surface we consume here).
// ---------------------------------------------------------------------------

interface NavigationApiNavigation {
	readonly currentEntry: { getState(): unknown } | null;
	navigate(
		url: string,
		options?: { history?: "push" | "replace"; state?: unknown; info?: unknown },
	): { committed: Promise<unknown>; finished: Promise<unknown> };
	back(): { committed: Promise<unknown> };
	forward(): { committed: Promise<unknown> };
	addEventListener(
		type: "navigate",
		listener: (event: NavigationApiNavigateEvent) => void,
	): void;
	addEventListener(
		type: "navigatesuccess",
		listener: (event: Event) => void,
	): void;
	removeEventListener(
		type: "navigate",
		listener: (event: NavigationApiNavigateEvent) => void,
	): void;
	removeEventListener(
		type: "navigatesuccess",
		listener: (event: Event) => void,
	): void;
}

interface NavigationApiNavigateEvent extends Event {
	readonly destination: { url: string; getState(): unknown };
	readonly navigationType: "push" | "replace" | "reload" | "traverse";
	readonly canIntercept: boolean;
	readonly userInitiated: boolean;
	intercept(options?: { handler?: () => Promise<void> | void }): void;
	redirect?(url: string, options?: { history?: "push" | "replace" }): void;
}

function navigationApi(): NavigationApiNavigation | undefined {
	return (globalThis as { navigation?: NavigationApiNavigation }).navigation;
}

// ---------------------------------------------------------------------------
// Navigation API adapter
// ---------------------------------------------------------------------------

export function createNavigationApiAdapter(): NavigationAdapter {
	const nav = navigationApi();
	if (!nav) {
		throw new Error(
			"[createNavigationApiAdapter] window.navigation is not available in this environment.",
		);
	}

	const beforeListeners = new Set<
		(intent: NavigationIntent) => void | Promise<void>
	>();
	const commitListeners = new Set<(commit: NavigationCommit) => void>();

	const handleNavigate = (event: NavigationApiNavigateEvent) => {
		if (beforeListeners.size === 0 && commitListeners.size === 0) return;
		if (!event.canIntercept) return;

		const url = new URL(event.destination.url, location.href);
		const cause: NavigationCause =
			event.navigationType === "push"
				? NavigationCause.Push
				: event.navigationType === "replace"
					? NavigationCause.Replace
					: NavigationCause.Traverse;

		let prevented = false;
		let redirectTarget: { url: URL; replace: boolean } | null = null;

		const intent: NavigationIntent = {
			url,
			cause,
			replace: event.navigationType === "replace",
			state: event.destination.getState(),
			preventDefault: () => {
				prevented = true;
				// There is no native preventDefault on NavigateEvent for
				// cancellation outside of `intercept({ handler })`, so we
				// throw inside the handler to abort the committed promise.
			},
			redirect: (target, options) => {
				redirectTarget = {
					url: new URL(target.toString(), url),
					replace: options?.replace ?? false,
				};
			},
		};

		event.intercept({
			handler: async () => {
				for (const listener of beforeListeners) {
					await listener(intent);
					if (prevented || redirectTarget) break;
				}
				if (prevented && !redirectTarget) {
					throw new DOMException(
						"Navigation prevented by interceptor",
						"AbortError",
					);
				}
				if (redirectTarget) {
					const target = redirectTarget as { url: URL; replace: boolean };
					nav.navigate(target.url.toString(), {
						history: target.replace ? "replace" : "push",
					});
					throw new DOMException(
						"Navigation redirected by interceptor",
						"AbortError",
					);
				}
				for (const listener of commitListeners) listener({ url });
			},
		});
	};

	const handleSuccess = (_event: Event) => {
		// Navigation API fires `navigatesuccess` even when no handler
		// intercepted. We still want to notify commit listeners for
		// such cases (typed external navigations).
		const url = new URL(location.href);
		for (const listener of commitListeners) listener({ url });
	};

	nav.addEventListener("navigate", handleNavigate);
	nav.addEventListener("navigatesuccess", handleSuccess);

	return {
		kind: NavigationAdapterKind.NavigationApi,
		currentUrl: () => new URL(location.href),
		navigate: async (url, options) => {
			const target = new URL(url.toString(), location.href);
			const result = nav.navigate(target.toString(), {
				history: options?.replace ? "replace" : "push",
				state: options?.state,
				info: options?.info,
			});
			await result.committed.catch(() => undefined);
		},
		back: () => {
			nav.back();
		},
		forward: () => {
			nav.forward();
		},
		onBeforeNavigate: (listener) => {
			beforeListeners.add(listener);
			return () => beforeListeners.delete(listener);
		},
		onNavigate: (listener) => {
			commitListeners.add(listener);
			return () => commitListeners.delete(listener);
		},
		destroy: () => {
			nav.removeEventListener("navigate", handleNavigate);
			nav.removeEventListener("navigatesuccess", handleSuccess);
			beforeListeners.clear();
			commitListeners.clear();
		},
	};
}

// ---------------------------------------------------------------------------
// History API fallback adapter
// ---------------------------------------------------------------------------

export interface CreateHistoryAdapterOptions {
	/**
	 * When true (default), the adapter captures clicks on in-document
	 * `<a href>` elements and routes them through `navigate()` so guards
	 * can intercept. Disable to handle anchor navigation manually.
	 */
	captureAnchorClicks?: boolean;
}

export function createHistoryAdapter(
	options: CreateHistoryAdapterOptions = {},
): NavigationAdapter {
	const captureAnchorClicks = options.captureAnchorClicks ?? true;

	const beforeListeners = new Set<
		(intent: NavigationIntent) => void | Promise<void>
	>();
	const commitListeners = new Set<(commit: NavigationCommit) => void>();

	const dispatchBefore = async (intent: NavigationIntent): Promise<boolean> => {
		for (const listener of beforeListeners) {
			await listener(intent);
		}
		return true;
	};

	const commit = (url: URL) => {
		for (const listener of commitListeners) listener({ url });
	};

	const handlePopstate = async (event: PopStateEvent) => {
		const url = new URL(location.href);
		let prevented = false;
		let redirectTarget: { url: URL; replace: boolean } | null = null;
		const intent: NavigationIntent = {
			url,
			cause: NavigationCause.Traverse,
			replace: false,
			state: event.state,
			preventDefault: () => {
				prevented = true;
			},
			redirect: (target, opts) => {
				redirectTarget = {
					url: new URL(target.toString(), url),
					replace: opts?.replace ?? false,
				};
			},
		};
		await dispatchBefore(intent);
		if (prevented && !redirectTarget) {
			// History API has no native way to cancel a popstate; the
			// best we can do is navigate forward to the previous URL.
			// Adopters that need true cancellation should prefer the
			// Navigation API path or use `intercept` for *pre*-action
			// decisions (e.g. chooser dialogs) rather than cancellation.
			return;
		}
		if (redirectTarget) {
			const target = redirectTarget as { url: URL; replace: boolean };
			if (target.replace) {
				history.replaceState(null, "", target.url.toString());
			} else {
				history.pushState(null, "", target.url.toString());
			}
			commit(target.url);
			return;
		}
		commit(url);
	};

	const handleAnchorClick = async (event: MouseEvent) => {
		if (
			event.defaultPrevented ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		) {
			return;
		}
		const path = event.composedPath();
		const anchor = path.find(
			(node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement,
		);
		if (!anchor || !anchor.href || anchor.target === "_blank") return;
		const targetUrl = new URL(anchor.href);
		if (targetUrl.origin !== location.origin) return;
		event.preventDefault();
		await navigateInternal(targetUrl, { replace: false });
	};

	const navigateInternal = async (
		url: URL,
		options: NavigateOptions,
	): Promise<void> => {
		let prevented = false;
		let redirectTarget: { url: URL; replace: boolean } | null = null;
		const intent: NavigationIntent = {
			url,
			cause: options.replace ? NavigationCause.Replace : NavigationCause.Push,
			replace: options.replace ?? false,
			state: options.state,
			preventDefault: () => {
				prevented = true;
			},
			redirect: (target, opts) => {
				redirectTarget = {
					url: new URL(target.toString(), url),
					replace: opts?.replace ?? false,
				};
			},
		};
		await dispatchBefore(intent);
		if (prevented && !redirectTarget) return;
		const target = redirectTarget
			? (redirectTarget as { url: URL; replace: boolean })
			: { url, replace: options.replace ?? false };
		if (target.replace) {
			history.replaceState(options.state ?? null, "", target.url.toString());
		} else {
			history.pushState(options.state ?? null, "", target.url.toString());
		}
		commit(target.url);
	};

	if (typeof window !== "undefined") {
		window.addEventListener("popstate", handlePopstate);
		if (captureAnchorClicks) {
			document.addEventListener("click", handleAnchorClick);
		}
	}

	return {
		kind: NavigationAdapterKind.History,
		currentUrl: () => new URL(location.href),
		navigate: (url, navOptions) =>
			navigateInternal(
				new URL(url.toString(), location.href),
				navOptions ?? {},
			),
		back: () => {
			history.back();
		},
		forward: () => {
			history.forward();
		},
		onBeforeNavigate: (listener) => {
			beforeListeners.add(listener);
			return () => beforeListeners.delete(listener);
		},
		onNavigate: (listener) => {
			commitListeners.add(listener);
			return () => commitListeners.delete(listener);
		},
		destroy: () => {
			if (typeof window !== "undefined") {
				window.removeEventListener("popstate", handlePopstate);
				if (captureAnchorClicks) {
					document.removeEventListener("click", handleAnchorClick);
				}
			}
			beforeListeners.clear();
			commitListeners.clear();
		},
	};
}

// ---------------------------------------------------------------------------
// Auto-select adapter
// ---------------------------------------------------------------------------

export interface CreateNavigationAdapterOptions {
	/**
	 * Force a specific adapter kind. Useful for tests that need to exercise
	 * the fallback path in a Chromium environment that ships the Navigation
	 * API.
	 * @default "auto"
	 */
	prefer?: "auto" | NavigationAdapterKind;
	/**
	 * Options forwarded to {@link createHistoryAdapter} when the history
	 * adapter is selected.
	 */
	history?: CreateHistoryAdapterOptions;
}

/**
 * Pick the best available navigation backend. Prefers the Web Navigation
 * API when `window.navigation` is defined; falls back to the History API
 * otherwise.
 */
export function createNavigationAdapter(
	options: CreateNavigationAdapterOptions = {},
): NavigationAdapter {
	const prefer = options.prefer ?? "auto";
	if (prefer === NavigationAdapterKind.History) {
		return createHistoryAdapter(options.history);
	}
	if (prefer === NavigationAdapterKind.NavigationApi) {
		return createNavigationApiAdapter();
	}
	if (navigationApi()) {
		return createNavigationApiAdapter();
	}
	return createHistoryAdapter(options.history);
}

/**
 * Quick capability probe — true when the Web Navigation API is present.
 */
export function isNavigationApiAvailable(): boolean {
	return navigationApi() !== undefined;
}
