import { SYMBOL_DISPOSE } from "../../compat";
import {
	type GuardedRouterTrait,
	type RouterBeforeLoad,
	type RouterGuardDecision,
	RouterGuardDecisionKind,
	RouterGuardPhase,
	type RouterNavigationRequest,
} from "../../router";
import { abortSignalToCancellationToken } from "../../std";
import { UriReferenceString } from "../../struct/uri-string";
import {
	type NativeWebNavigateEventLike,
	type ResolvedRouterForNativeWebCreateOptions,
	type RouterForNativeWebCreateOptions,
	resolveRouterForNativeWebCreateOptions,
	WebLegacyRouter,
	WebNavigationRouter,
} from "./router";

export interface GuardedRouterForNativeWebCreateOptions
	extends RouterForNativeWebCreateOptions {
	beforeLoad: RouterBeforeLoad;
}

export function createGuardedRouterForNativeWeb(
	options: GuardedRouterForNativeWebCreateOptions,
): GuardedRouterTrait {
	return new GuardedNativeWebRouter(
		resolveRouterForNativeWebCreateOptions(options),
		options.beforeLoad,
	);
}

export class GuardedNativeWebRouter implements GuardedRouterTrait {
	protected readonly router:
		| GuardedWebNavigationRouter
		| GuardedWebLegacyRouter;

	constructor(
		options: ResolvedRouterForNativeWebCreateOptions,
		readonly beforeLoad: RouterBeforeLoad,
	) {
		this.router =
			options.navigation?.addEventListener &&
			options.navigation.removeEventListener
				? new GuardedWebNavigationRouter(options, beforeLoad)
				: new GuardedWebLegacyRouter(options, beforeLoad);
	}

	currentUrl() {
		return this.router.currentUrl();
	}

	baseURI() {
		return this.router.baseURI();
	}

	navigate(request: RouterNavigationRequest): void | Promise<void> {
		return this.router.navigate(request);
	}

	dispose(): void {
		this.router.dispose();
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}
}

export class GuardedWebNavigationRouter
	extends WebNavigationRouter
	implements GuardedRouterTrait
{
	protected readonly navigateHandler: (
		event: NativeWebNavigateEventLike,
	) => void;

	constructor(
		options: ResolvedRouterForNativeWebCreateOptions,
		readonly beforeLoad: RouterBeforeLoad,
	) {
		super(options);
		this.navigateHandler = (event) => {
			if (event.canIntercept === false) {
				return;
			}
			event.intercept({
				handler: async () => {
					const destinationUrl = event.destination?.url;
					if (!destinationUrl) {
						return;
					}
					const currentUrl = this.currentUrl();
					const decision = await this.beforeLoad({
						phase: RouterGuardPhase.Navigate,
						url: UriReferenceString.parse(destinationUrl),
						currentUrl,
						baseURI: this.baseURI(),
						cancellationToken: event.signal
							? abortSignalToCancellationToken(event.signal)
							: undefined,
					});
					await this.applyNavigationDecision(decision, {
						url: UriReferenceString.parse(destinationUrl),
						mode: event.navigationType === "replace" ? "replace" : "push",
						intent: "post_auth_redirect",
						state: event.destination?.getState?.(),
					});
				},
			});
		};
		options.navigation?.addEventListener?.("navigate", this.navigateHandler);
	}

	dispose(): void {
		this.navigation.removeEventListener?.("navigate", this.navigateHandler);
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}

	protected async applyNavigationDecision(
		decision: RouterGuardDecision,
		request: RouterNavigationRequest,
	): Promise<void> {
		if (decision.kind === RouterGuardDecisionKind.Allow) {
			return;
		}
		if (decision.kind === RouterGuardDecisionKind.Block) {
			throw new DOMException(
				"Navigation blocked by router guard.",
				"AbortError",
			);
		}
		await super.navigate({
			...request,
			url: decision.url,
			mode: decision.mode ?? request.mode,
			state: decision.state ?? request.state,
		});
		throw new DOMException(
			"Navigation redirected by router guard.",
			"AbortError",
		);
	}

	override async navigate(request: RouterNavigationRequest): Promise<void> {
		const decision = await evaluateNavigateRequest(
			this,
			this.beforeLoad,
			request,
		);
		if (decision.kind === RouterGuardDecisionKind.Allow) {
			await super.navigate(request);
			return;
		}
		if (decision.kind === RouterGuardDecisionKind.Block) {
			return;
		}
		await super.navigate({
			...request,
			url: decision.url,
			mode: decision.mode ?? request.mode,
			state: decision.state ?? request.state,
		});
	}
}

export class GuardedWebLegacyRouter
	extends WebLegacyRouter
	implements GuardedRouterTrait
{
	constructor(
		options: ResolvedRouterForNativeWebCreateOptions,
		readonly beforeLoad: RouterBeforeLoad,
	) {
		super(options);
	}

	dispose(): void {}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}

	override async navigate(request: RouterNavigationRequest): Promise<void> {
		const decision = await evaluateNavigateRequest(
			this,
			this.beforeLoad,
			request,
		);
		if (decision.kind === RouterGuardDecisionKind.Allow) {
			super.navigate(request);
			return;
		}
		if (decision.kind === RouterGuardDecisionKind.Block) {
			return;
		}
		super.navigate({
			...request,
			url: decision.url,
			mode: decision.mode ?? request.mode,
			state: decision.state ?? request.state,
		});
	}
}

async function evaluateNavigateRequest(
	router: Pick<GuardedNativeWebRouter, "currentUrl" | "baseURI" | "navigate">,
	beforeLoad: RouterBeforeLoad,
	request: RouterNavigationRequest,
): Promise<RouterGuardDecision> {
	const currentUrl = router.currentUrl();
	return await beforeLoad({
		phase: RouterGuardPhase.Navigate,
		url: request.url,
		currentUrl,
		baseURI: router.baseURI(),
		request,
	});
}
