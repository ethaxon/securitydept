import {
	createSignal,
	mapResource,
	type ResourceSnapshot,
	ResourceStatus,
	resourceFromSnapshots,
} from "@securitydept/client";
import { type TokenSetAuthSnapshot } from "@securitydept/token-set-context-client/orchestration";

export function bearerHeaderForSnapshot(
	snapshot: TokenSetAuthSnapshot | null,
): string | undefined {
	return snapshot?.tokens.accessToken
		? `Bearer ${snapshot.tokens.accessToken}`
		: undefined;
}

export function createTestTokenSetReactiveFields(
	initialSnapshot: TokenSetAuthSnapshot | null = null,
) {
	const authSnapshot = createSignal<
		ResourceSnapshot<TokenSetAuthSnapshot | null>
	>({ status: ResourceStatus.Idle });
	const authResource = resourceFromSnapshots(() => authSnapshot.get());
	const authorizationHeaderValue = mapResource(
		authResource,
		bearerHeaderForSnapshot,
	);
	const isAuthenticated = mapResource(
		authorizationHeaderValue,
		(header) => header !== undefined,
	);

	const emitSnapshot = (snapshot: TokenSetAuthSnapshot | null): void => {
		authSnapshot.set({ status: ResourceStatus.Resolved, value: snapshot });
	};

	const emitError = (error: unknown): void => {
		const current = authSnapshot.get();
		authSnapshot.set({
			status: ResourceStatus.Error,
			value:
				current.status === ResourceStatus.Reloading ||
				current.status === ResourceStatus.Resolved ||
				current.status === ResourceStatus.Error
					? current.value
					: null,
			error,
		});
	};

	emitSnapshot(initialSnapshot);

	return {
		fields: {
			authSnapshot,
			authResource,
			isAuthenticated,
			authorizationHeaderValue,
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
