import {
	createLocalStorageStore,
	createSessionStorageStore,
} from "../persistence/web";
import type { ClientEnvironment as FoundationClientEnvironment } from "../runtime/types";
import type { FetchTransportOptions } from "../transport/fetch-transport";
import { createWebClientEnvironmentDependencies } from "./runtime";

export type { ClientEnvironment } from "../runtime/types";

export const ClientEnvironmentPreset = {
	BrowserPage: "browser_page",
	BrowserWorker: "browser_worker",
	ServiceWorker: "service_worker",
	BrowserExtensionBackground: "browser_extension_background",
} as const;
export type ClientEnvironmentPreset =
	(typeof ClientEnvironmentPreset)[keyof typeof ClientEnvironmentPreset];

export interface WebClientEnvironment extends FoundationClientEnvironment {
	preset?: ClientEnvironmentPreset;
}

export interface PageLocationLike {
	href: string;
	hash: string;
	pathname?: string;
	search?: string;
}

export interface PageHistoryLike {
	replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

export interface PageLocationCapability {
	location: PageLocationLike;
}

export interface PageLocationHistoryCapability extends PageLocationCapability {
	history: PageHistoryLike;
}

export interface PageClientEnvironment
	extends WebClientEnvironment,
		PageLocationHistoryCapability {}

export interface CreateWebClientEnvironmentOptions
	extends Partial<Omit<FoundationClientEnvironment, "transport">> {
	transport?: FoundationClientEnvironment["transport"];
	fetchTransport?: FetchTransportOptions;
	preset?: ClientEnvironmentPreset;
}

export interface CreateBrowserPageClientEnvironmentOptions
	extends CreateWebClientEnvironmentOptions {
	pageCapability?: PageLocationHistoryCapability;
}

export interface RequirePageClientEnvironmentOptions {
	environment?: WebClientEnvironment | PageClientEnvironment;
	pageCapability?: PageLocationHistoryCapability;
}

const PAGE_LOCATION_ERROR_MESSAGE =
	"browser redirect helpers require a page-like window.location.\n" +
	"For extension background or service worker hosts, keep redirects in a real page context or pass explicit location capability.";

const PAGE_LOCATION_HISTORY_ERROR_MESSAGE =
	"backend-oidc page callback bootstrap requires a page-like window.location and window.history.\n" +
	"For extension background or service worker hosts, use restore-only flow or pass explicit location/history/store capabilities.";

const EXPLICIT_PAGE_ENVIRONMENT_ERROR_MESSAGE =
	"page helpers require an explicit page environment.\n" +
	"Create one in your composition root with createBrowserPageClientEnvironment(...).\n" +
	"For worker, service worker, or extension background hosts, keep page-only redirects and callbacks in a real page context.";

const EXPLICIT_PAGE_LOCATION_HISTORY_CAPABILITY_ERROR_MESSAGE =
	"page helpers require an explicit page environment with location and history.\n" +
	"Create one in your composition root with createBrowserPageClientEnvironment(...), or pass an explicit pageCapability override.";

const BROWSER_PERSISTENT_PREFIX = "securitydept.web.client:";
const BROWSER_SESSION_PREFIX = "securitydept.web.client:";

export function createWebClientEnvironment(
	options: CreateWebClientEnvironmentOptions = {},
): WebClientEnvironment {
	const { preset, ...environmentOptions } = options;
	const resolvedEnvironment =
		createWebClientEnvironmentDependencies(environmentOptions);
	return {
		...resolvedEnvironment,
		preset,
	};
}

export function deriveClientEnvironment(
	environment: FoundationClientEnvironment,
): FoundationClientEnvironment {
	return {
		transport: environment.transport,
		scheduler: environment.scheduler,
		clock: environment.clock,
		logger: environment.logger,
		traceSink: environment.traceSink,
		operationTracer: environment.operationTracer,
		persistentStore: environment.persistentStore,
		sessionStore: environment.sessionStore,
	};
}

export function createBrowserPageClientEnvironment(
	options: CreateBrowserPageClientEnvironmentOptions = {},
): PageClientEnvironment {
	const pageCapability = options.pageCapability
		? assertPageLocationHistoryCapability(options.pageCapability)
		: requireDefaultPageLocationHistoryCapability();

	return {
		...createWebClientEnvironment({
			...withDefaultBrowserStores(options),
			preset: ClientEnvironmentPreset.BrowserPage,
		}),
		...pageCapability,
	};
}

export function readDefaultPageLocationCapability(): PageLocationCapability | null {
	const windowLike = (globalThis as unknown as { window?: unknown }).window;
	if (!isObject(windowLike)) {
		return null;
	}

	const location = (windowLike as { location?: unknown }).location;
	return readPageLocationCapability({ location });
}

export function requireDefaultPageLocationCapability(): PageLocationCapability {
	const pageCapability = readDefaultPageLocationCapability();
	if (!pageCapability) {
		throw new Error(PAGE_LOCATION_ERROR_MESSAGE);
	}

	return pageCapability;
}

export function createBrowserWorkerClientEnvironment(
	options: CreateWebClientEnvironmentOptions = {},
): WebClientEnvironment {
	return createWebClientEnvironment({
		...options,
		preset: ClientEnvironmentPreset.BrowserWorker,
	});
}

export function createServiceWorkerClientEnvironment(
	options: CreateWebClientEnvironmentOptions = {},
): WebClientEnvironment {
	return createWebClientEnvironment({
		...options,
		preset: ClientEnvironmentPreset.ServiceWorker,
	});
}

export function createBrowserExtensionBackgroundClientEnvironment(
	options: CreateWebClientEnvironmentOptions = {},
): WebClientEnvironment {
	return createWebClientEnvironment({
		...options,
		preset: ClientEnvironmentPreset.BrowserExtensionBackground,
	});
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

export function assertResolveFromEnvironment<TEnvironment, TValue>(
	environment: TEnvironment | null | undefined,
	select: (environment: TEnvironment) => TValue | null | undefined,
	onResolvingCapabilityFail: () => never,
): Exclude<TValue, null | undefined> {
	const resolvedEnvironment = assertResolveEnvironment(
		environment,
		onResolvingCapabilityFail,
	);
	const resolvedValue = select(resolvedEnvironment);
	if (resolvedValue === null || resolvedValue === undefined) {
		return onResolvingCapabilityFail();
	}

	return resolvedValue as Exclude<TValue, null | undefined>;
}

export function requirePageClientEnvironment(
	environmentOrOptions?:
		| PageClientEnvironment
		| RequirePageClientEnvironmentOptions,
): PageClientEnvironment {
	const options =
		normalizeRequirePageClientEnvironmentOptions(environmentOrOptions);
	const environment = assertResolveEnvironment(
		options.environment,
		failMissingPageEnvironment,
	);
	const pageCapability = resolvePageLocationHistoryCapability(
		options,
		environment,
	);

	return {
		...environment,
		...pageCapability,
	};
}

export function readDefaultPageLocationHistoryCapability(): PageLocationHistoryCapability | null {
	const windowLike = (globalThis as unknown as { window?: unknown }).window;
	if (!isObject(windowLike)) {
		return null;
	}

	const location = (windowLike as { location?: unknown }).location;
	const history = (windowLike as { history?: unknown }).history;
	return readPageLocationHistoryCapability({ location, history });
}

export function requireDefaultPageLocationHistoryCapability(): PageLocationHistoryCapability {
	const pageCapability = readDefaultPageLocationHistoryCapability();
	if (!pageCapability) {
		throw new Error(PAGE_LOCATION_HISTORY_ERROR_MESSAGE);
	}

	return pageCapability;
}

export function readPageLocationCapability(input: {
	location?: unknown;
}): PageLocationCapability | null {
	const location = input.location;
	if (!isPageLocationLike(location)) {
		return null;
	}

	return { location };
}

export function readPageLocationHistoryCapability(input: {
	location?: unknown;
	history?: unknown;
}): PageLocationHistoryCapability | null {
	const pageCapability = readPageLocationCapability(input);
	const history = input.history;
	if (!pageCapability || !isPageHistoryLike(history)) {
		return null;
	}

	return {
		...pageCapability,
		history,
	};
}

export function assertPageLocationCapability(
	pageCapability: unknown,
	fieldName = "environment",
): PageLocationCapability {
	if (!isObject(pageCapability)) {
		throw new Error(
			`${fieldName} must include location.href and location.hash.\n${PAGE_LOCATION_ERROR_MESSAGE}`,
		);
	}

	const normalized = readPageLocationCapability(
		pageCapability as { location?: unknown },
	);
	if (!normalized) {
		throw new Error(
			`${fieldName} must include location.href and location.hash.\n${PAGE_LOCATION_ERROR_MESSAGE}`,
		);
	}

	return normalized;
}

export function assertPageLocationHistoryCapability(
	pageCapability: unknown,
	fieldName = "pageCapability",
): PageLocationHistoryCapability {
	if (!isObject(pageCapability)) {
		throw new Error(
			`${fieldName} must include location.href, location.hash, and history.replaceState.\n${PAGE_LOCATION_HISTORY_ERROR_MESSAGE}`,
		);
	}

	const normalized = readPageLocationHistoryCapability(
		pageCapability as { location?: unknown; history?: unknown },
	);
	if (!normalized) {
		throw new Error(
			`${fieldName} must include location.href, location.hash, and history.replaceState.\n${PAGE_LOCATION_HISTORY_ERROR_MESSAGE}`,
		);
	}

	return normalized;
}

function normalizeRequirePageClientEnvironmentOptions(
	environmentOrOptions?:
		| PageClientEnvironment
		| RequirePageClientEnvironmentOptions,
): RequirePageClientEnvironmentOptions {
	if (!environmentOrOptions) {
		return {};
	}

	if ("transport" in environmentOrOptions) {
		return { environment: environmentOrOptions };
	}

	return environmentOrOptions;
}

function resolvePageLocationHistoryCapability(
	options: RequirePageClientEnvironmentOptions,
	environment: WebClientEnvironment | PageClientEnvironment,
): PageLocationHistoryCapability {
	if (options.pageCapability !== undefined) {
		return assertPageLocationHistoryCapability(
			options.pageCapability,
			"pageCapability",
		);
	}

	return assertResolveFromEnvironment(
		environment,
		(candidateEnvironment) =>
			readPageLocationHistoryCapability(
				candidateEnvironment as { location?: unknown; history?: unknown },
			),
		failMissingPageLocationHistoryCapability,
	);
}

function failMissingPageEnvironment(): never {
	throw new Error(EXPLICIT_PAGE_ENVIRONMENT_ERROR_MESSAGE);
}

function failMissingPageLocationHistoryCapability(): never {
	throw new Error(EXPLICIT_PAGE_LOCATION_HISTORY_CAPABILITY_ERROR_MESSAGE);
}

function withDefaultBrowserStores<
	TOptions extends CreateWebClientEnvironmentOptions,
>(options: TOptions): TOptions {
	return {
		...options,
		persistentStore:
			options.persistentStore ??
			createLocalStorageStore(BROWSER_PERSISTENT_PREFIX),
		sessionStore:
			options.sessionStore ?? createSessionStorageStore(BROWSER_SESSION_PREFIX),
	};
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isPageLocationLike(value: unknown): value is PageLocationLike {
	return (
		isObject(value) &&
		typeof value.href === "string" &&
		typeof value.hash === "string"
	);
}

function isPageHistoryLike(value: unknown): value is PageHistoryLike {
	return isObject(value) && typeof value.replaceState === "function";
}
