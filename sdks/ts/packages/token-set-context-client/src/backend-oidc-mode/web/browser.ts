import type {
	Clock,
	EphemeralFlowStore,
	HttpTransport,
	RecordStore,
	Scheduler,
	TraceEventSinkTrait,
} from "@securitydept/client";
import {
	ClientError,
	ClientErrorKind,
	createEphemeralFlowStore,
	createJsonCodec,
	FetchTransportRedirectKind,
	UserRecovery,
} from "@securitydept/client";
import {
	createLocalStorageStore,
	createSessionStorageStore,
} from "@securitydept/client/persistence/web";
import { createWebRuntime } from "@securitydept/client/web";
import { BackendOidcModeClient } from "../client";
import type { AuthStateSnapshot } from "../types";

const TOKEN_SET_PERSISTENT_PREFIX = "securitydept.web.token_set:";
const TOKEN_SET_SESSION_PREFIX = "securitydept.web.token_set:";
const TOKEN_SET_CALLBACK_FRAGMENT_KEY = "pending_callback_fragment";

export interface LocationLike {
	href: string;
	hash: string;
}

export interface HistoryLike {
	replaceState(data: unknown, unused: string, url?: string): void;
}

export const BackendOidcModeBootstrapSource = {
	Callback: "callback",
	Restore: "restore",
	Empty: "empty",
} as const;
export type BackendOidcModeBootstrapSource =
	(typeof BackendOidcModeBootstrapSource)[keyof typeof BackendOidcModeBootstrapSource];

export interface BackendOidcModeBootstrapResult {
	source: BackendOidcModeBootstrapSource;
	snapshot: AuthStateSnapshot | null;
}

export interface CreateBackendOidcModeBrowserClientOptions {
	baseUrl?: string;
	defaultPostAuthRedirectUri?: string;
	persistentStore?: RecordStore;
	sessionStore?: RecordStore;
	transport?: HttpTransport;
	scheduler?: Scheduler;
	clock?: Clock;
	traceSink?: TraceEventSinkTrait;
	refreshWindowMs?: number;
}

export function createBackendOidcModeBrowserClient(
	options: CreateBackendOidcModeBrowserClientOptions = {},
): BackendOidcModeClient {
	const runtime = createWebRuntime({
		transport: options.transport,
		scheduler: options.scheduler,
		clock: options.clock,
		traceSink: options.traceSink,
		persistentStore:
			options.persistentStore ??
			createLocalStorageStore(TOKEN_SET_PERSISTENT_PREFIX),
		sessionStore:
			options.sessionStore ??
			createSessionStorageStore(TOKEN_SET_SESSION_PREFIX),
		fetchTransport: {
			redirect: FetchTransportRedirectKind.Manual,
		},
	});

	return new BackendOidcModeClient(
		{
			baseUrl: options.baseUrl ?? "",
			defaultPostAuthRedirectUri: options.defaultPostAuthRedirectUri,
			refreshWindowMs: options.refreshWindowMs,
		},
		runtime,
	);
}

export function createBackendOidcModeCallbackFragmentStore(
	sessionStore = createSessionStorageStore(TOKEN_SET_SESSION_PREFIX),
): EphemeralFlowStore<string> {
	return createEphemeralFlowStore<string>({
		store: sessionStore,
		key: TOKEN_SET_CALLBACK_FRAGMENT_KEY,
		codec: createJsonCodec<string>(),
	});
}

export function resolveBackendOidcModeReturnUri(
	location: Pick<LocationLike, "href"> = window.location,
): string {
	const url = new URL(location.href);
	url.hash = "";
	return url.toString();
}

export async function captureBackendOidcModeCallbackFragmentFromUrl(
	options: {
		location?: LocationLike;
		history?: HistoryLike;
		callbackFragmentStore?: EphemeralFlowStore<string>;
	} = {},
): Promise<string | null> {
	const location = options.location ?? window.location;
	const history = options.history ?? window.history;
	const callbackFragmentStore =
		options.callbackFragmentStore ??
		createBackendOidcModeCallbackFragmentStore();
	const fragment = location.hash.startsWith("#")
		? location.hash.slice(1)
		: location.hash;

	if (!fragment) {
		return null;
	}

	await callbackFragmentStore.save(fragment);
	const url = new URL(location.href);
	url.hash = "";
	history.replaceState(null, "", `${url.pathname}${url.search}`);
	return fragment;
}

export async function bootstrapBackendOidcModeClient(
	client: BackendOidcModeClient,
	options: {
		location?: LocationLike;
		history?: HistoryLike;
		callbackFragmentStore?: EphemeralFlowStore<string>;
	} = {},
): Promise<BackendOidcModeBootstrapResult> {
	const callbackFragmentStore =
		options.callbackFragmentStore ??
		createBackendOidcModeCallbackFragmentStore();

	await captureBackendOidcModeCallbackFragmentFromUrl({
		location: options.location,
		history: options.history,
		callbackFragmentStore,
	});

	const pendingFragment = await callbackFragmentStore.load();
	if (pendingFragment) {
		try {
			const snapshot = await client.handleCallback(pendingFragment);
			await callbackFragmentStore.clear();
			return {
				source: BackendOidcModeBootstrapSource.Callback,
				snapshot,
			};
		} catch (error) {
			if (!shouldRetainCallbackFragment(error)) {
				await callbackFragmentStore.clear();
			}
			throw error;
		}
	}

	const restored = await client.restorePersistedState();
	if (restored) {
		return {
			source: BackendOidcModeBootstrapSource.Restore,
			snapshot: restored,
		};
	}

	return {
		source: BackendOidcModeBootstrapSource.Empty,
		snapshot: null,
	};
}

export function resolveBackendOidcModeAuthorizeUrl(
	client: BackendOidcModeClient,
	location: Pick<LocationLike, "href"> = window.location,
): string {
	return client.authorizeUrl(resolveBackendOidcModeReturnUri(location));
}

export async function resetBackendOidcModeBrowserState(
	client: BackendOidcModeClient,
	callbackFragmentStore = createBackendOidcModeCallbackFragmentStore(),
): Promise<void> {
	await callbackFragmentStore.clear();
	await client.clearState();
}

function isCancelledClientError(error: unknown): boolean {
	return error instanceof ClientError
		? error.kind === ClientErrorKind.Cancelled
		: typeof error === "object" &&
				error !== null &&
				"kind" in error &&
				error.kind === ClientErrorKind.Cancelled;
}

function shouldRetainCallbackFragment(error: unknown): boolean {
	if (isCancelledClientError(error)) {
		return true;
	}

	if (error instanceof ClientError) {
		return error.retryable;
	}

	return (
		typeof error === "object" &&
		error !== null &&
		(("retryable" in error && error.retryable === true) ||
			("recovery" in error && error.recovery === UserRecovery.Retry))
	);
}
