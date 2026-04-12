// @securitydept/client/web-router — raw web router subpath (iteration 110)
//
// Canonical import:
//   import {
//     createWebRouter,
//     createNavigationAdapter,
//     NavigationAdapterKind,
//   } from "@securitydept/client/web-router";
//
// See `navigation-adapter.ts` for the Navigation API vs History API
// selection rules, and `web-router.ts` for route matching / planner-host
// integration.
//
// Stability: provisional (new in iteration 110)

export type {
	CreateHistoryAdapterOptions,
	CreateNavigationAdapterOptions,
	NavigateOptions,
	NavigationAdapter,
	NavigationCause,
	NavigationCommit,
	NavigationIntent,
} from "./navigation-adapter";
export {
	createHistoryAdapter,
	createNavigationAdapter,
	createNavigationApiAdapter,
	isNavigationApiAvailable,
	NavigationAdapterKind,
} from "./navigation-adapter";
export type {
	CreateWebRouterOptions,
	FullRouteRequirementsOptions,
	WebRouteContext,
	WebRouteDefinition,
	WebRouteMatch,
	WebRouteMatcher,
	WebRouter,
} from "./web-router";
export {
	createWebRouter,
	defineWebRoute,
	extractFullRouteRequirements,
	RequirementsClientSetComposition,
} from "./web-router";
