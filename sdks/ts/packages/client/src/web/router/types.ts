/** @see https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigation */
export interface Navigation extends EventTarget {
	entries(): NavigationHistoryEntry[];
	readonly currentEntry?: NavigationHistoryEntry;
	updateCurrentEntry(options: NavigationUpdateCurrentEntryOptions): void;
	readonly transition?: NavigationTransition;

	readonly canGoBack: boolean;
	readonly canGoForward: boolean;

	navigate(url: string, options?: NavigationNavigateOptions): NavigationResult;
	reload(options?: NavigationReloadOptions): NavigationResult;

	traverseTo(key: string, options?: NavigationOptions): NavigationResult;
	back(options?: NavigationOptions): NavigationResult;
	forward(options?: NavigationOptions): NavigationResult;

	onnavigate:
		| ((this: Navigation, ev: NavigationEventMap["navigate"]) => any)
		| null;
	onnavigatesuccess:
		| ((this: Navigation, ev: NavigationEventMap["navigatesuccess"]) => any)
		| null;
	onnavigateerror:
		| ((this: Navigation, ev: NavigationEventMap["navigateerror"]) => any)
		| null;
	oncurrententrychange:
		| ((this: Navigation, ev: NavigationEventMap["currententrychange"]) => any)
		| null;

	addEventListener<K extends keyof NavigationEventMap>(
		type: K,
		listener: (this: Navigation, ev: NavigationEventMap[K]) => any,
		options?: boolean | AddEventListenerOptions,
	): void;
	addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	): void;
	removeEventListener<K extends keyof NavigationEventMap>(
		type: K,
		listener: (this: Navigation, ev: NavigationEventMap[K]) => any,
		options?: boolean | EventListenerOptions,
	): void;
	removeEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | EventListenerOptions,
	): void;
}

export interface NavigationEventMap {
	navigate: NavigateEvent;
	navigatesuccess: Event;
	navigateerror: ErrorEvent;
	currententrychange: NavigationCurrentEntryChangeEvent;
}

/** @see https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigateevent */
export interface NavigateEvent extends Event {
	readonly navigationType: NavigationApiNavigationType;
	readonly destination: NavigationDestination;
	readonly canIntercept: boolean;
	readonly userInitiated: boolean;
	readonly hashChange: boolean;
	readonly signal: AbortSignal;
	readonly formData: FormData | null;
	readonly downloadRequest: string | null;
	readonly info: any;
	readonly hasUAVisualTransition: boolean;
	readonly sourceElement: Element | null;

	intercept(options?: NavigationInterceptOptions): void;
	/**
	 * Not in HTML spec but implemented in Chromium
	 * @see https://github.com/WICG/navigation-api?tab=readme-ov-file#deferred-commit
	 * @experimental
	 */
	commit(): void;
	/**
	 * Not in HTML spec but implemented in Chromium
	 * @see https://github.com/WICG/navigation-api?tab=readme-ov-file#redirects-during-deferred-commit
	 * @experimental
	 */
	redirect(): void;
	scroll(): void;
}

/** @see https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigateeventinit */
export interface NavigateEventInit extends EventInit {
	navigationType?: NavigationApiNavigationType;
	destination: NavigationDestination;
	canIntercept?: boolean;
	userInitiated?: boolean;
	hashChange?: boolean;
	signal: AbortSignal;
	formData?: FormData | null;
	downloadRequest?: string | null;
	info?: any;
	hasUAVisualTransition?: boolean;
	sourceElement?: Element | null;
}

/** @see https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-navigationcurrententrychangeevent-interface */
export interface NavigationCurrentEntryChangeEvent extends Event {
	readonly navigationType?: NavigationApiNavigationType;
	readonly from: NavigationHistoryEntry;
}

/** @see https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationcurrententrychangeeventinit */
export interface NavigationCurrentEntryChangeEventInit extends EventInit {
	navigationType?: NavigationApiNavigationType;
	destination: NavigationHistoryEntry;
}

/** @see https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationhistoryentry */
export interface NavigationHistoryEntry extends EventTarget {
	readonly url: string | null;
	readonly key: string;
	readonly id: string;
	readonly index: number;
	readonly sameDocument: boolean;

	getState(): any;

	ondispose: ((this: NavigationHistoryEntry, ev: Event) => any) | null;

	addEventListener(
		type: "dispose",
		callback: (this: NavigationHistoryEntry, ev: Event) => any,
		options?: boolean | AddEventListenerOptions,
	): void;
	addEventListener(
		type: string,
		callback: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	): void;
	removeEventListener(
		type: "dispose",
		callback: (this: NavigationHistoryEntry, ev: Event) => any,
		options?: boolean | EventListenerOptions,
	): void;
	removeEventListener(
		type: string,
		callback: EventListenerOrEventListenerObject,
		options?: boolean | EventListenerOptions,
	): void;
}

/** @see https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationdestination */
export interface NavigationDestination {
	readonly url: string;
	readonly key: string | null;
	readonly id: string | null;
	readonly index: number;
	readonly sameDocument: boolean;

	getState(): any;
}

/** @see https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationupdatecurrententryoptions */
export interface NavigationUpdateCurrentEntryOptions {
	state: any;
}

/** @see https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationoptions */
export interface NavigationOptions {
	info?: any;
}

/** @see https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationnavigateoptions */
export interface NavigationNavigateOptions extends NavigationOptions {
	state?: any;
	// Defaults to "auto"
	history?: NavigationHistoryBehavior;
}

/** @see https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationreloadoptions */
export interface NavigationReloadOptions extends NavigationOptions {
	state?: any;
}

/** @see https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationtransition */
export interface NavigationTransition {
	readonly navigationType: NavigationApiNavigationType;
	readonly from: NavigationHistoryEntry;
	readonly finished: Promise<void>;
}

/** @see https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationresult */
export interface NavigationResult {
	committed: Promise<NavigationHistoryEntry>;
	finished: Promise<NavigationHistoryEntry>;
}

/** @see https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationinterceptoptions */
export interface NavigationInterceptOptions {
	handler?: NavigationInterceptHandler;
	focusReset?: NavigationFocusReset;
	scroll?: NavigationScrollBehavior;
	/**
	 * Not in HTML spec but implemented in Chromium
	 * @see https://github.com/WICG/navigation-api?tab=readme-ov-file#deferred-commit
	 * @experimental
	 */
	commit?: NavigationCommitBehavior;
}

/** @see https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationtype */
export type NavigationApiNavigationType =
	| "reload"
	| "push"
	| "replace"
	| "traverse";

/** @see https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationhistorybehavior */
export type NavigationHistoryBehavior = "auto" | "push" | "replace";

/** @see https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationintercepthandler */
export type NavigationInterceptHandler = () => Promise<void>;

/** @see https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationfocusreset */
export type NavigationFocusReset = "after-transition" | "manual";

/** @see https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationscrollbehavior */
export type NavigationScrollBehavior = "after-transition" | "manual";

/**
 * Not in HTML spec but implemented in Chromium
 * @see https://github.com/WICG/navigation-api?tab=readme-ov-file#deferred-commit
 * @experimental
 */
type NavigationCommitBehavior = "after-transition" | "immediate";
