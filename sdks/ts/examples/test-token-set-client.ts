import { createReplaySignal, createSignal } from "@securitydept/client";
import {
	AuthCheckStatus,
	type AuthSnapshot,
	TokenSetAuthFlowReason,
} from "@securitydept/token-set-context-client/orchestration";

export function bearerHeaderForSnapshot(
	snapshot: AuthSnapshot | null,
): string | undefined {
	return snapshot?.tokens.accessToken
		? `Bearer ${snapshot.tokens.accessToken}`
		: undefined;
}

export function createTestTokenSetReactiveFields(
	initialSnapshot: AuthSnapshot | null = null,
) {
	const authDetermined = createReplaySignal<true>();
	const authSnapshot = createReplaySignal<AuthSnapshot | null>();
	const isAuthenticated = createReplaySignal<boolean>();
	const authorizationHeaderValue = createReplaySignal<string | undefined>();
	const lastAuthError = createSignal<unknown | undefined>(undefined);

	const emitSnapshot = (snapshot: AuthSnapshot | null): void => {
		authSnapshot.emit(snapshot);
		authorizationHeaderValue.emit(bearerHeaderForSnapshot(snapshot));
		isAuthenticated.emit(bearerHeaderForSnapshot(snapshot) !== undefined);
		lastAuthError.set(undefined);
		authDetermined.emit(true);
	};

	const emitError = (error: unknown): void => {
		lastAuthError.set(error);
		authDetermined.emit(true);
	};

	emitSnapshot(initialSnapshot);

	return {
		fields: {
			authDetermined,
			authSnapshot,
			isAuthenticated,
			authorizationHeaderValue,
			lastAuthError,
			authOperations: {
				restorePending: createSignal(false),
				refreshPending: createSignal(false),
				clearPending: createSignal(false),
				loginPending: createSignal(false),
			},
			authCheck: async () => {
				const slot = authSnapshot.get();
				return authCheckResultForSnapshot(
					slot.kind === "value" ? slot.value : null,
				);
			},
		},
		emitSnapshot,
		emitError,
	};
}

export function authCheckResultForSnapshot(snapshot: AuthSnapshot | null) {
	if (!snapshot) {
		return {
			status: AuthCheckStatus.Unauthenticated,
			snapshot: null,
			authorizationHeader: null,
			reason: TokenSetAuthFlowReason.NoSnapshot,
		} as const;
	}
	return {
		status: AuthCheckStatus.Authenticated,
		snapshot,
		freshness: "fresh",
		authorizationHeader: bearerHeaderForSnapshot(snapshot),
	} as const;
}
