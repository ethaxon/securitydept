import type {
	RouterNavigationRequest,
	RouterTrait,
} from "../../environment/types";
import type { EnvironmentValidators } from "../../environment/validators";
import { validateEnvTraitInput } from "../../environment/validators";

export interface NativeWebNavigationLike {
	navigate(
		url: string,
		options?: { history?: "push" | "replace"; state?: unknown },
	): { committed?: Promise<unknown>; finished?: Promise<unknown> } | void;
}

export interface NativeWebLocationLike {
	href: string;
	hash?: string;
	pathname?: string;
	search?: string;
	origin?: string;
}

export interface NativeWebHistoryLike {
	pushState?(data: unknown, unused: string, url?: string | URL | null): void;
	replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

export interface NativeWebWindowLike {
	location?: NativeWebLocationLike;
	history?: NativeWebHistoryLike;
	open?(url?: string | URL, target?: string, features?: string): unknown;
}

export interface CreateRouterForNativeWebOptions {
	navigation?: NativeWebNavigationLike | null;
	location?: NativeWebLocationLike | null;
	history?: NativeWebHistoryLike | null;
	window?: NativeWebWindowLike | null;
	validators?: Pick<EnvironmentValidators, "router">;
}

export function createRouterForNativeWeb(
	options: CreateRouterForNativeWebOptions = {},
): RouterTrait {
	const global = globalThis as {
		navigation?: NativeWebNavigationLike;
		location?: NativeWebLocationLike;
		history?: NativeWebHistoryLike;
		window?: NativeWebWindowLike;
	};
	const windowLike = options.window ?? global.window ?? null;
	const navigation = options.navigation ?? global.navigation ?? null;
	const location = options.location ?? windowLike?.location ?? global.location;
	const history = options.history ?? windowLike?.history ?? global.history;
	validateEnvTraitInput({
		traitName: "router",
		hostAdapter: "createRouterForNativeWeb",
		value: { navigation, location, history, window: windowLike },
		validator: options.validators?.router,
		bundleValidate: (value) => {
			const input = value as {
				navigation?: NativeWebNavigationLike | null;
				location?: NativeWebLocationLike | null;
				history?: NativeWebHistoryLike | null;
			};
			return Boolean(
				typeof input.navigation?.navigate === "function" ||
					typeof input.location?.href === "string",
			);
		},
	});

	const router: RouterTrait = {
		currentUrl() {
			return location?.href ? new URL(location.href) : null;
		},
		canNavigate() {
			return Boolean(navigation || (location && history) || location);
		},
		async navigate(request: RouterNavigationRequest) {
			const base = location?.href;
			const target = request.url.toString();
			const resolvedTarget = base ? new URL(target, base).toString() : target;
			if (request.mode === "external") {
				if (location) {
					location.href = resolvedTarget;
					return;
				}
				throw new Error(
					"Native web router cannot perform external navigation.",
				);
			}
			if (navigation) {
				const result = navigation.navigate(resolvedTarget, {
					history: request.mode === "replace" ? "replace" : "push",
					state: request.state,
				});
				await result?.committed;
				return;
			}
			if (!history) {
				throw new Error(
					"Native web router requires history for in-page navigation.",
				);
			}
			if (request.mode === "replace" || !history.pushState) {
				history.replaceState(request.state ?? null, "", target);
			} else {
				history.pushState(request.state ?? null, "", target);
			}
		},
	};

	return router;
}

export interface CreateRouterForTestOptions {
	currentUrl?: string | URL | null;
	onNavigate?: (request: RouterNavigationRequest) => void | Promise<void>;
	validators?: Pick<EnvironmentValidators, "router">;
}

export function createRouterForTest(
	options: CreateRouterForTestOptions = {},
): RouterTrait {
	validateEnvTraitInput({
		traitName: "router",
		hostAdapter: "createRouterForTest",
		value: options,
		validator: options.validators?.router,
		bundleValidate: (value) => {
			const input = value as CreateRouterForTestOptions;
			return (
				(input.currentUrl === undefined ||
					input.currentUrl === null ||
					typeof input.currentUrl === "string" ||
					input.currentUrl instanceof URL) &&
				(input.onNavigate === undefined ||
					typeof input.onNavigate === "function")
			);
		},
	});
	let currentUrl =
		options.currentUrl === undefined || options.currentUrl === null
			? null
			: new URL(options.currentUrl.toString());
	const router: RouterTrait = {
		currentUrl: () => currentUrl,
		canNavigate: () => true,
		async navigate(request) {
			await options.onNavigate?.(request);
			currentUrl = new URL(request.url.toString(), currentUrl ?? undefined);
		},
	};
	return router;
}
