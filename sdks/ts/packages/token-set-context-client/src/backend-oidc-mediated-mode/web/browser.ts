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
import { BackendOidcMediatedModeClient } from "../client";
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

export const BackendOidcMediatedModeBootstrapSource = {
	Callback: "callback",
	Restore: "restore",
	Empty: "empty",
} as const;
export type BackendOidcMediatedModeBootstrapSource =
	(typeof BackendOidcMediatedModeBootstrapSource)[keyof typeof BackendOidcMediatedModeBootstrapSource];

export interface BackendOidcMediatedModeBootstrapResult {
	source: BackendOidcMediatedModeBootstrapSource;
	snapshot: AuthStateSnapshot | null;
}

export interface CreateBackendOidcMediatedModeBrowserClientOptions {
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

export function createBackendOidcMediatedModeBrowserClient(
	options: CreateBackendOidcMediatedModeBrowserClientOptions = {},
): BackendOidcMediatedModeClient {
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

	return new BackendOidcMediatedModeClient(
		{
			baseUrl: options.baseUrl ?? "",
			defaultPostAuthRedirectUri: options.defaultPostAuthRedirectUri,
			refreshWindowMs: options.refreshWindowMs,
		},
		runtime,
	);
}

export function createBackendOidcMediatedModeCallbackFragmentStore(
	sessionStore = createSessionStorageStore(TOKEN_SET_SESSION_PREFIX),
): EphemeralFlowStore<string> {
	return createEphemeralFlowStore<string>({
		store: sessionStore,
		key: TOKEN_SET_CALLBACK_FRAGMENT_KEY,
		codec: createJsonCodec<string>(),
	});
}

export function resolveBackendOidcMediatedModeReturnUri(
	location: Pick<LocationLike, "href"> = window.location,
): string {
	const url = new URL(location.href);
	url.hash = "";
	return url.toString();
}

export async function captureBackendOidcMediatedModeCallbackFragmentFromUrl(
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
		createBackendOidcMediatedModeCallbackFragmentStore();
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

export async function bootstrapBackendOidcMediatedModeClient(
	client: BackendOidcMediatedModeClient,
	options: {
		location?: LocationLike;
		history?: HistoryLike;
		callbackFragmentStore?: EphemeralFlowStore<string>;
	} = {},
): Promise<BackendOidcMediatedModeBootstrapResult> {
	const callbackFragmentStore =
		options.callbackFragmentStore ??
		createBackendOidcMediatedModeCallbackFragmentStore();

	await captureBackendOidcMediatedModeCallbackFragmentFromUrl({
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
				source: BackendOidcMediatedModeBootstrapSource.Callback,
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
			source: BackendOidcMediatedModeBootstrapSource.Restore,
			snapshot: restored,
		};
	}

	return {
		source: BackendOidcMediatedModeBootstrapSource.Empty,
		snapshot: null,
	};
}

export function resolveBackendOidcMediatedModeAuthorizeUrl(
	client: BackendOidcMediatedModeClient,
	location: Pick<LocationLike, "href"> = window.location,
): string {
	return client.authorizeUrl(resolveBackendOidcMediatedModeReturnUri(location));
}

export async function resetBackendOidcMediatedModeBrowserState(
	client: BackendOidcMediatedModeClient,
	callbackFragmentStore = createBackendOidcMediatedModeCallbackFragmentStore(),
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
