import { createReplaySignal, createSignal } from "@securitydept/client";
import { type AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";

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
		authSnapshot.setValue(snapshot);
		authorizationHeaderValue.setValue(bearerHeaderForSnapshot(snapshot));
		isAuthenticated.setValue(bearerHeaderForSnapshot(snapshot) !== undefined);
		lastAuthError.set(undefined);
		authDetermined.setValue(true);
	};

	const emitError = (error: unknown): void => {
		lastAuthError.set(error);
		authDetermined.setValue(true);
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
		},
		emitSnapshot,
		emitError,
	};
}
