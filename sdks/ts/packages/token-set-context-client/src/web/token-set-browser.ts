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
import { TokenSetContextClient } from "../client";
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

export const TokenSetBootstrapSource = {
	Callback: "callback",
	Restore: "restore",
	Empty: "empty",
} as const;
export type TokenSetBootstrapSource =
	(typeof TokenSetBootstrapSource)[keyof typeof TokenSetBootstrapSource];

export interface TokenSetBootstrapResult {
	source: TokenSetBootstrapSource;
	snapshot: AuthStateSnapshot | null;
}

export interface CreateTokenSetBrowserClientOptions {
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

export function createTokenSetBrowserClient(
	options: CreateTokenSetBrowserClientOptions = {},
): TokenSetContextClient {
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

	return new TokenSetContextClient(
		{
			baseUrl: options.baseUrl ?? "",
			defaultPostAuthRedirectUri: options.defaultPostAuthRedirectUri,
			refreshWindowMs: options.refreshWindowMs,
		},
		runtime,
	);
}

export function createTokenSetCallbackFragmentStore(
	sessionStore = createSessionStorageStore(TOKEN_SET_SESSION_PREFIX),
): EphemeralFlowStore<string> {
	return createEphemeralFlowStore<string>({
		store: sessionStore,
		key: TOKEN_SET_CALLBACK_FRAGMENT_KEY,
		codec: createJsonCodec<string>(),
	});
}

export function resolveTokenSetReturnUri(
	location: Pick<LocationLike, "href"> = window.location,
): string {
	const url = new URL(location.href);
	url.hash = "";
	return url.toString();
}

export async function captureTokenSetCallbackFragmentFromUrl(
	options: {
		location?: LocationLike;
		history?: HistoryLike;
		callbackFragmentStore?: EphemeralFlowStore<string>;
	} = {},
): Promise<string | null> {
	const location = options.location ?? window.location;
	const history = options.history ?? window.history;
	const callbackFragmentStore =
		options.callbackFragmentStore ?? createTokenSetCallbackFragmentStore();
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

export async function bootstrapTokenSetClient(
	client: TokenSetContextClient,
	options: {
		location?: LocationLike;
		history?: HistoryLike;
		callbackFragmentStore?: EphemeralFlowStore<string>;
	} = {},
): Promise<TokenSetBootstrapResult> {
	const callbackFragmentStore =
		options.callbackFragmentStore ?? createTokenSetCallbackFragmentStore();

	await captureTokenSetCallbackFragmentFromUrl({
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
				source: TokenSetBootstrapSource.Callback,
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
			source: TokenSetBootstrapSource.Restore,
			snapshot: restored,
		};
	}

	return {
		source: TokenSetBootstrapSource.Empty,
		snapshot: null,
	};
}

export function resolveTokenSetAuthorizeUrl(
	client: TokenSetContextClient,
	location: Pick<LocationLike, "href"> = window.location,
): string {
	return client.authorizeUrl(resolveTokenSetReturnUri(location));
}

export async function resetTokenSetBrowserState(
	client: TokenSetContextClient,
	callbackFragmentStore = createTokenSetCallbackFragmentStore(),
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
