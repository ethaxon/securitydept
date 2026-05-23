import { createClientEnvironment } from "../../environment/create";
import type {
	FoundationEnvironment,
	PageLifecycleTrait,
	PopupTrait,
	RouterTrait,
	TelemetryTrait,
} from "../../environment/types";
import type { EnvironmentValidators } from "../../environment/validators";
import type { StorageTrait } from "../../persistence/types";
import type { IdleCallbackTrait, TimeTrait } from "../../scheduling/types";
import { createExternalTransportForFetch } from "../../std/transport";
import type { BaseTransportTrait } from "../../transport/types";
import {
	type CreatePageLifecycleForNativeWebOptions,
	createPageLifecycleForNativeWeb,
} from "./page-lifecycle";
import { createPopupForNativeWeb } from "./popup";
import {
	createRouterForNativeWeb,
	type NativeWebHistoryLike,
	type NativeWebLocationLike,
	type NativeWebNavigationLike,
	type NativeWebWindowLike,
} from "./router";
import {
	createPersistentStorageForNativeWeb,
	createSessionStorageForNativeWeb,
	type NativeWebStorageLike,
} from "./storage";

export type { FoundationEnvironment } from "../../environment/types";

export interface NativeWebEnvironment extends FoundationEnvironment {
	router: RouterTrait;
	pageLifecycle?: PageLifecycleTrait;
	popup?: PopupTrait;
}

export interface CreateEnvironmentForNativeWebOptions {
	transport?: BaseTransportTrait;
	time?: TimeTrait;
	idleCallback?: IdleCallbackTrait;
	persistentStorage?: StorageTrait;
	sessionStorage?: StorageTrait;
	telemetry?: TelemetryTrait;
	router?: RouterTrait;
	pageLifecycle?: PageLifecycleTrait;
	popup?: PopupTrait;
	navigation?: NativeWebNavigationLike | null;
	location?: NativeWebLocationLike | null;
	history?: NativeWebHistoryLike | null;
	window?: NativeWebWindowLike | null;
	document?: CreatePageLifecycleForNativeWebOptions["document"];
	localStorage?: NativeWebStorageLike | null;
	sessionStorageHost?: NativeWebStorageLike | null;
	persistentStoragePrefix?: string | null;
	sessionStoragePrefix?: string | null;
	validators?: EnvironmentValidators;
}

export function createEnvironmentForNativeWeb(
	options: CreateEnvironmentForNativeWebOptions = {},
): NativeWebEnvironment {
	const global = globalThis as {
		history?: NativeWebHistoryLike;
		location?: NativeWebLocationLike;
		localStorage?: NativeWebStorageLike;
		open?: unknown;
		sessionStorage?: NativeWebStorageLike;
	};
	const routerInputs = {
		navigation: options.navigation,
		location: options.location ?? global.location,
		history: options.history ?? global.history,
		window: options.window,
	};
	const nativeWebLocation =
		routerInputs.location ?? routerInputs.window?.location ?? null;
	const nativeWebHistory =
		routerInputs.history ?? routerInputs.window?.history ?? null;
	assertNativeWebLocationHistory(
		{ location: nativeWebLocation, history: nativeWebHistory },
		"nativeWeb",
	);
	const popupInputs = {
		location: nativeWebLocation,
		window: options.window,
	};
	const pageLifecycleInputs = {
		document: options.document,
		window: options.window as
			| CreatePageLifecycleForNativeWebOptions["window"]
			| undefined,
	};
	const transport = options.transport ?? createExternalTransportForFetch();
	const router =
		options.router ??
		createRouterForNativeWeb({
			...routerInputs,
			location: nativeWebLocation,
			history: nativeWebHistory,
			validators: options.validators,
		});
	const pageLifecycle =
		options.pageLifecycle ??
		(hasNativePageLifecycleInput(pageLifecycleInputs)
			? createPageLifecycleForNativeWeb({
					...pageLifecycleInputs,
					validators: options.validators,
				})
			: undefined);
	const popup =
		options.popup ??
		(hasNativePopupInput(popupInputs)
			? createPopupForNativeWeb({
					...popupInputs,
					validators: options.validators,
				})
			: undefined);
	const persistentStorage =
		options.persistentStorage ??
		((options.localStorage ?? global.localStorage)
			? createPersistentStorageForNativeWeb({
					storage: options.localStorage ?? global.localStorage ?? null,
					prefix: options.persistentStoragePrefix ?? undefined,
					validators: options.validators,
				})
			: undefined);
	const sessionStorage =
		options.sessionStorage ??
		((options.sessionStorageHost ?? global.sessionStorage)
			? createSessionStorageForNativeWeb({
					storage: options.sessionStorageHost ?? global.sessionStorage ?? null,
					prefix: options.sessionStoragePrefix ?? undefined,
					validators: options.validators,
				})
			: undefined);

	const environment = createClientEnvironment({
		transport,
		time: options.time,
		idleCallback: options.idleCallback,
		persistentStorage,
		sessionStorage,
		telemetry: options.telemetry,
		router,
		pageLifecycle,
		popup,
		validators: options.validators,
	});

	return {
		...environment,
	} as NativeWebEnvironment;
}

function hasNativePopupInput(input: {
	location?: NativeWebLocationLike | null;
	window?: NativeWebWindowLike | null;
}): boolean {
	return Boolean(
		typeof input.window?.open === "function" ||
			typeof (globalThis as { open?: unknown }).open === "function",
	);
}

function hasNativePageLifecycleInput(input: {
	document?: CreatePageLifecycleForNativeWebOptions["document"];
	window?: CreatePageLifecycleForNativeWebOptions["window"];
}): boolean {
	return Boolean(
		input.document?.addEventListener || input.window?.addEventListener,
	);
}

export function assertResolveEnvironment<T>(
	environment: T | null | undefined,
	onResolvingEnvironmentFail: () => never,
): Exclude<T, null | undefined> {
	if (environment === null || environment === undefined) {
		return onResolvingEnvironmentFail();
	}

	return environment as Exclude<T, null | undefined>;
}

function isNativeWebLocationLike(
	value: unknown,
): value is NativeWebLocationLike {
	return typeof value === "object" && value !== null && "href" in value;
}

function assertNativeWebLocationHistory(
	input: { location?: unknown; history?: unknown },
	fieldName: string,
): asserts input is {
	location: NativeWebLocationLike;
	history: NativeWebHistoryLike;
} {
	if (
		!isNativeWebLocationLike(input.location) ||
		!isNativeWebHistoryLike(input.history)
	) {
		throw new Error(
			`${fieldName} must include location.href and history.replaceState.`,
		);
	}
}

function isNativeWebHistoryLike(value: unknown): value is NativeWebHistoryLike {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as NativeWebHistoryLike).replaceState === "function"
	);
}
