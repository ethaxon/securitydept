import { fromEventPattern } from "@securitydept/client";
import { fromStorageEvent } from "@securitydept/client/web";
import {
	TOKEN_SET_BACKEND_MODE_CLIENT_KEY,
	TOKEN_SET_FRONTEND_MODE_CLIENT_KEY,
} from "@/lib/tokenSetConfig";

// Auth context mode — tracks which authentication context the user chose
// at the login chooser. Persisted to localStorage so logout, API gating,
// and navigation can branch correctly.

const STORAGE_KEY = "securitydept.webui.auth_context_mode";
const AUTH_CONTEXT_CHANGE_EVENT = "securitydept.webui.auth_context_mode.change";

export const AuthContextMode = {
	Session: "session",
	TokenSetBackend: "token-set-backend-mode",
	TokenSetFrontend: "token-set-frontend-mode",
	Basic: "basic",
} as const;

export type AuthContextMode =
	(typeof AuthContextMode)[keyof typeof AuthContextMode];

function notifyAuthContextModeChanged(): void {
	if (typeof window === "undefined") {
		return;
	}
	window.dispatchEvent(new Event(AUTH_CONTEXT_CHANGE_EVENT));
}

export function getAuthContextMode(): AuthContextMode | null {
	const raw = localStorage.getItem(STORAGE_KEY);
	if (
		raw === AuthContextMode.Session ||
		raw === AuthContextMode.TokenSetBackend ||
		raw === AuthContextMode.TokenSetFrontend ||
		raw === AuthContextMode.Basic
	) {
		return raw;
	}
	return null;
}

export function resolveAuthContextMode(): AuthContextMode {
	return getAuthContextMode() ?? AuthContextMode.Session;
}

export function subscribeAuthContextMode(listener: () => void): () => void {
	if (typeof window === "undefined") {
		return () => {};
	}

	const storageSubscription = fromStorageEvent({
		target: window,
		callback: (event) => {
			if (event.key === null || event.key === STORAGE_KEY) {
				listener();
			}
		},
	});
	const changeSubscription = fromEventPattern<Event>({
		addHandler: (handler) => {
			window.addEventListener(
				AUTH_CONTEXT_CHANGE_EVENT,
				handler as EventListener,
			);
		},
		removeHandler: (handler) => {
			window.removeEventListener(
				AUTH_CONTEXT_CHANGE_EVENT,
				handler as EventListener,
			);
		},
		callback: () => {
			listener();
		},
	});

	return () => {
		storageSubscription.unsubscribe();
		changeSubscription.unsubscribe();
	};
}

export function setAuthContextMode(mode: AuthContextMode): void {
	localStorage.setItem(STORAGE_KEY, mode);
	notifyAuthContextModeChanged();
}

export function clearAuthContextMode(): void {
	localStorage.removeItem(STORAGE_KEY);
	notifyAuthContextModeChanged();
}

export function isTokenSetAuthContextMode(
	mode: AuthContextMode | null,
): mode is
	| typeof AuthContextMode.TokenSetBackend
	| typeof AuthContextMode.TokenSetFrontend {
	return (
		mode === AuthContextMode.TokenSetBackend ||
		mode === AuthContextMode.TokenSetFrontend
	);
}

export function resolveTokenSetClientKey(
	mode: AuthContextMode | null,
): string | null {
	if (mode === AuthContextMode.TokenSetBackend) {
		return TOKEN_SET_BACKEND_MODE_CLIENT_KEY;
	}

	if (mode === AuthContextMode.TokenSetFrontend) {
		return TOKEN_SET_FRONTEND_MODE_CLIENT_KEY;
	}

	return null;
}
