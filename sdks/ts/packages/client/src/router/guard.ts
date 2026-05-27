import { type CancellationTokenTrait } from "../cancellation";
import { type DisposableTrait } from "../compat";
import { type RouterNavigationRequest, type RouterTrait } from "./router";

export const RouterGuardDecisionKind = {
	Allow: "allow",
	Block: "block",
	Redirect: "redirect",
} as const;

export type RouterGuardDecisionKind =
	(typeof RouterGuardDecisionKind)[keyof typeof RouterGuardDecisionKind];

export type RouterGuardDecision =
	| { kind: typeof RouterGuardDecisionKind.Allow }
	| { kind: typeof RouterGuardDecisionKind.Block }
	| {
			kind: typeof RouterGuardDecisionKind.Redirect;
			url: string | URL;
			mode?: "push" | "replace" | "external";
			state?: unknown;
	  };

export const RouterGuardPhase = {
	Initial: "initial",
	Navigate: "navigate",
} as const;

export type RouterGuardPhase =
	(typeof RouterGuardPhase)[keyof typeof RouterGuardPhase];

export interface RouterGuardContext {
	readonly phase: RouterGuardPhase;
	readonly url: URL;
	readonly currentUrl: URL | null;
	readonly request?: RouterNavigationRequest;
	readonly cancellationToken?: CancellationTokenTrait;
}

export type RouterBeforeLoad = (
	context: RouterGuardContext,
) => RouterGuardDecision | Promise<RouterGuardDecision>;

export interface GuardedRouterTrait extends RouterTrait, DisposableTrait {
	readonly beforeLoad: RouterBeforeLoad;
}
