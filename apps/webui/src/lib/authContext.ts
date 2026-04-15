// Auth context mode — tracks which authentication context the user chose
// at the login chooser. Persisted to localStorage so logout, API gating,
// and navigation can branch correctly.

const STORAGE_KEY = "securitydept.webui.auth_context_mode";
const AUTH_CONTEXT_CHANGE_EVENT = "securitydept.webui.auth_context_mode.change";

export const AuthContextMode = {
	Session: "session",
	TokenSet: "token-set",
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
		raw === AuthContextMode.TokenSet ||
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

	const handleStorage = (event: StorageEvent) => {
		if (event.key === null || event.key === STORAGE_KEY) {
			listener();
		}
	};

	window.addEventListener("storage", handleStorage);
	window.addEventListener(AUTH_CONTEXT_CHANGE_EVENT, listener);

	return () => {
		window.removeEventListener("storage", handleStorage);
		window.removeEventListener(AUTH_CONTEXT_CHANGE_EVENT, listener);
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
