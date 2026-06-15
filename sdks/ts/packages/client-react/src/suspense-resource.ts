import {
	ClientError,
	ClientErrorKind,
	createCancellationTokenSource,
	createComputed,
	type ReadableSignalTrait,
	type ResourceSnapshot,
	ResourceStatus,
	type ResourceTrait,
	whenResourceSnapshotValue,
} from "@securitydept/client";
import { type DependencyList, useMemo, useSyncExternalStore } from "react";
import { useResourceSnapshot } from "./interop";
import {
	hashQueryStoreKey,
	QueryObserver,
	type QueryResult,
	QueryResultStatus,
	type QueryStoreKey,
	useQueryStore,
} from "./query-store";

const SUSPENSE_RESOURCE_ERROR_SOURCE = "client-react.suspense-resource";

interface QueryExternalStore<T> {
	readonly subscribe: (listener: () => void) => () => void;
	readonly getSnapshot: () => QueryResult<T> | undefined;
	readonly getServerSnapshot: () => QueryResult<T> | undefined;
}

const BYPASSED_QUERY_STORE = Object.freeze({
	subscribe: () => () => undefined,
	getSnapshot: () => undefined,
	getServerSnapshot: () => undefined,
});

export interface UseSuspenseResourceValueOptions {
	readonly queryKey?: QueryStoreKey;
	readonly gcTimeMs?: number;
	readonly retainWhilePending?: boolean;
}

export interface UseSuspenseComputedResourceValueOptions
	extends Omit<UseSuspenseResourceValueOptions, "queryKey"> {
	readonly dependencies: DependencyList;
	readonly queryKey: QueryStoreKey;
}

export function useSuspenseResourceValue<T>(
	resource: ResourceTrait<T>,
	options?: UseSuspenseResourceValueOptions,
): T;
export function useSuspenseResourceValue<T>(
	snapshot: ReadableSignalTrait<ResourceSnapshot<T>>,
	options?: UseSuspenseResourceValueOptions,
): T;
export function useSuspenseResourceValue<T>(
	compute: () => ResourceSnapshot<T>,
	options: UseSuspenseComputedResourceValueOptions,
): T;
export function useSuspenseResourceValue<T>(
	source:
		| ResourceTrait<T>
		| ReadableSignalTrait<ResourceSnapshot<T>>
		| (() => ResourceSnapshot<T>),
	options:
		| UseSuspenseResourceValueOptions
		| UseSuspenseComputedResourceValueOptions = {},
): T {
	const queryStore = useQueryStore();
	let hash: string;
	let createSnapshotSignal: () => ReadableSignalTrait<ResourceSnapshot<T>>;
	let snapshotSignalDependencies: DependencyList;

	if (typeof source === "function") {
		const computedOptions = options as UseSuspenseComputedResourceValueOptions;
		const dependencies = computedOptions.dependencies;
		if (!Array.isArray(dependencies)) {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				code: "react.query.computed_dependencies_required",
				message:
					"useSuspenseResourceValue() requires dependencies for computed input.",
				source: SUSPENSE_RESOURCE_ERROR_SOURCE,
			});
		}
		if (!Array.isArray(computedOptions.queryKey)) {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				code: "react.query.computed_query_key_required",
				message:
					"useSuspenseResourceValue() requires a queryKey for computed input.",
				source: SUSPENSE_RESOURCE_ERROR_SOURCE,
			});
		}
		hash = hashQueryStoreKey(["resource_compute", ...computedOptions.queryKey]);
		createSnapshotSignal = () => createComputed(source);
		snapshotSignalDependencies = dependencies;
	} else {
		const snapshotSignal = "snapshot" in source ? source.snapshot : source;
		hash = hashQueryStoreKey([
			"resource_snapshot",
			{ sourceId: queryStore.getWeakKeyId(snapshotSignal) },
			...(options.queryKey ?? []),
		]);
		createSnapshotSignal = () => snapshotSignal;
		snapshotSignalDependencies = [snapshotSignal];
	}
	const snapshotSignal = useMemo(
		createSnapshotSignal,
		// biome-ignore lint/correctness/useExhaustiveDependencies: The caller owns the computed closure dependencies.
		snapshotSignalDependencies,
	);
	const snapshot = useResourceSnapshot(snapshotSignal);
	const queryRequired =
		snapshot.status === ResourceStatus.Idle ||
		snapshot.status === ResourceStatus.Loading;

	const queryStoreBindings = useMemo<QueryExternalStore<T>>(() => {
		if (!queryRequired) {
			return BYPASSED_QUERY_STORE;
		}

		const observer = new QueryObserver<T>(queryStore, {
			hash,
			source: () => {
				const cancellation = createCancellationTokenSource();
				return {
					cancel: () => cancellation.cancel(),
					input: whenResourceSnapshotValue(snapshotSignal, {
						cancellationToken: cancellation.token,
					}),
				};
			},
			gcTimeMs: options.gcTimeMs,
			retainWhilePending: options.retainWhilePending,
		});
		return {
			subscribe: observer.subscribe,
			getSnapshot: observer.getSnapshot,
			getServerSnapshot: observer.getServerSnapshot,
		};
	}, [
		queryRequired,
		queryStore,
		hash,
		options.gcTimeMs,
		options.retainWhilePending,
		snapshotSignal,
	]);
	const result = useSyncExternalStore(
		queryStoreBindings.subscribe,
		queryStoreBindings.getSnapshot,
		queryStoreBindings.getServerSnapshot,
	);

	switch (snapshot.status) {
		case ResourceStatus.Idle:
		case ResourceStatus.Loading: {
			const queryResult = result as QueryResult<T>;
			if (queryResult.status === QueryResultStatus.Pending) {
				throw queryResult.promise;
			}
			if (queryResult.status === QueryResultStatus.Error) {
				throw queryResult.error;
			}
			return queryResult.value;
		}
		case ResourceStatus.LoadingError:
			throw snapshot.error;
		case ResourceStatus.Reloading:
		case ResourceStatus.Resolved:
		case ResourceStatus.Error:
			return snapshot.value;
	}
}
