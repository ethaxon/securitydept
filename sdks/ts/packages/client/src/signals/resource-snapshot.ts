import { filter, firstValueFrom, from, map, merge, NEVER } from "rxjs";
import {
	type ReadableSignalTrait,
	type ResourceErrorSnapshot,
	type ResourceLoadingErrorSnapshot,
	type ResourceReloadingSnapshot,
	type ResourceResolvedSnapshot,
	type ResourceSnapshot,
	ResourceStatus,
	type ResourceWhenValueOptions,
} from "./types";

export async function whenResourceSnapshotValue<T>(
	snapshotSignal: ReadableSignalTrait<ResourceSnapshot<T>>,
	options?: ResourceWhenValueOptions,
): Promise<T> {
	options?.cancellationToken?.throwIfCancellationRequested();
	const staleValueWhenError = options?.staleValueWhenError ?? true;
	const current = snapshotSignal.get();
	if (
		current.status === ResourceStatus.Resolved ||
		current.status === ResourceStatus.Reloading ||
		(current.status === ResourceStatus.Error && staleValueWhenError)
	) {
		return current.value;
	}
	if (
		current.status === ResourceStatus.LoadingError ||
		current.status === ResourceStatus.Error
	) {
		throw current.error;
	}

	const snapshot = await firstValueFrom(
		merge(
			from(snapshotSignal).pipe(
				filter(
					(
						snapshot,
					): snapshot is
						| ResourceResolvedSnapshot<T>
						| ResourceReloadingSnapshot<T>
						| ResourceLoadingErrorSnapshot
						| ResourceErrorSnapshot<T> =>
						snapshot.status === ResourceStatus.Resolved ||
						snapshot.status === ResourceStatus.Reloading ||
						snapshot.status === ResourceStatus.LoadingError ||
						snapshot.status === ResourceStatus.Error,
				),
			),
			(options?.cancellationToken
				? from(options.cancellationToken)
				: NEVER
			).pipe(
				map(({ cancellationError }) => {
					throw cancellationError;
				}),
			),
		),
	);

	if (snapshot.status === ResourceStatus.LoadingError) {
		throw snapshot.error;
	}
	if (snapshot.status === ResourceStatus.Error && !staleValueWhenError) {
		throw snapshot.error;
	}
	return snapshot.value;
}

type AnyResourceSnapshotSelector = (
	// More than four levels intentionally falls back to runtime composition.
	value: any,
) => ReadableSignalTrait<ResourceSnapshot<unknown>>;

export function flattenResourceSnapshot<T1, T2>(
	sourceSnapshot: ResourceSnapshot<T1>,
	select1: (value: T1) => ReadableSignalTrait<ResourceSnapshot<T2>>,
): ResourceSnapshot<T2>;
export function flattenResourceSnapshot<T1, T2, T3>(
	sourceSnapshot: ResourceSnapshot<T1>,
	select1: (value: T1) => ReadableSignalTrait<ResourceSnapshot<T2>>,
	select2: (value: T2) => ReadableSignalTrait<ResourceSnapshot<T3>>,
): ResourceSnapshot<T3>;
export function flattenResourceSnapshot<T1, T2, T3, T4>(
	sourceSnapshot: ResourceSnapshot<T1>,
	select1: (value: T1) => ReadableSignalTrait<ResourceSnapshot<T2>>,
	select2: (value: T2) => ReadableSignalTrait<ResourceSnapshot<T3>>,
	select3: (value: T3) => ReadableSignalTrait<ResourceSnapshot<T4>>,
): ResourceSnapshot<T4>;
export function flattenResourceSnapshot<T1, T2, T3, T4, T5>(
	sourceSnapshot: ResourceSnapshot<T1>,
	select1: (value: T1) => ReadableSignalTrait<ResourceSnapshot<T2>>,
	select2: (value: T2) => ReadableSignalTrait<ResourceSnapshot<T3>>,
	select3: (value: T3) => ReadableSignalTrait<ResourceSnapshot<T4>>,
	select4: (value: T4) => ReadableSignalTrait<ResourceSnapshot<T5>>,
): ResourceSnapshot<T5>;
export function flattenResourceSnapshot(
	sourceSnapshot: ResourceSnapshot<unknown>,
	select: AnyResourceSnapshotSelector,
	...selectors: readonly AnyResourceSnapshotSelector[]
): ResourceSnapshot<unknown>;
/**
 * Flatten nested resource snapshots while tracking each selected snapshot signal.
 * Ancestor reload and error states remain visible whenever the final snapshot has
 * a value; an ancestor error without a final value becomes a loading error.
 */
export function flattenResourceSnapshot(
	sourceSnapshot: ResourceSnapshot<unknown>,
	...selectors: readonly AnyResourceSnapshotSelector[]
): ResourceSnapshot<unknown> {
	let snapshot = sourceSnapshot;
	let reloading = false;
	let hasError = false;
	let error: unknown;

	for (const select of selectors) {
		switch (snapshot.status) {
			case ResourceStatus.Idle:
			case ResourceStatus.Loading:
				return hasError
					? { status: ResourceStatus.LoadingError, error }
					: snapshot;
			case ResourceStatus.LoadingError:
				return hasError
					? { status: ResourceStatus.LoadingError, error }
					: snapshot;
			case ResourceStatus.Reloading:
				reloading = true;
				snapshot = select(snapshot.value).get();
				break;
			case ResourceStatus.Resolved:
				snapshot = select(snapshot.value).get();
				break;
			case ResourceStatus.Error:
				if (!hasError) {
					hasError = true;
					error = snapshot.error;
				}
				snapshot = select(snapshot.value).get();
				break;
		}
	}

	switch (snapshot.status) {
		case ResourceStatus.Idle:
		case ResourceStatus.Loading:
		case ResourceStatus.LoadingError:
			return hasError
				? { status: ResourceStatus.LoadingError, error }
				: snapshot;
		case ResourceStatus.Reloading:
			return hasError
				? { status: ResourceStatus.Error, value: snapshot.value, error }
				: snapshot;
		case ResourceStatus.Resolved:
			return hasError
				? { status: ResourceStatus.Error, value: snapshot.value, error }
				: reloading
					? { status: ResourceStatus.Reloading, value: snapshot.value }
					: snapshot;
		case ResourceStatus.Error:
			return hasError
				? { status: ResourceStatus.Error, value: snapshot.value, error }
				: snapshot;
	}
}

export const ResourceSnapshotUpdateKind = {
	Load: "load",
	Resolve: "resolve",
	Fail: "fail",
	FailWithValue: "fail_with_value",
} as const;

export type ResourceSnapshotUpdateKind =
	(typeof ResourceSnapshotUpdateKind)[keyof typeof ResourceSnapshotUpdateKind];

export type ResourceSnapshotUpdate<T> =
	| { readonly kind: typeof ResourceSnapshotUpdateKind.Load }
	| {
			readonly kind: typeof ResourceSnapshotUpdateKind.Resolve;
			readonly value: T;
	  }
	| {
			readonly kind: typeof ResourceSnapshotUpdateKind.Fail;
			readonly error: unknown;
	  }
	| {
			readonly kind: typeof ResourceSnapshotUpdateKind.FailWithValue;
			readonly value: T;
			readonly error: unknown;
	  };

export function reduceResourceSnapshot<T>(
	previous: ResourceSnapshot<T>,
	update: ResourceSnapshotUpdate<T>,
): ResourceSnapshot<T> {
	switch (update.kind) {
		case ResourceSnapshotUpdateKind.Load:
			return previous.status === ResourceStatus.Reloading ||
				previous.status === ResourceStatus.Resolved ||
				previous.status === ResourceStatus.Error
				? { status: ResourceStatus.Reloading, value: previous.value }
				: { status: ResourceStatus.Loading };
		case ResourceSnapshotUpdateKind.Resolve:
			return { status: ResourceStatus.Resolved, value: update.value };
		case ResourceSnapshotUpdateKind.Fail:
			return previous.status === ResourceStatus.Reloading ||
				previous.status === ResourceStatus.Resolved ||
				previous.status === ResourceStatus.Error
				? {
						status: ResourceStatus.Error,
						value: previous.value,
						error: update.error,
					}
				: {
						status: ResourceStatus.LoadingError,
						error: update.error,
					};
		case ResourceSnapshotUpdateKind.FailWithValue:
			return {
				status: ResourceStatus.Error,
				value: update.value,
				error: update.error,
			};
	}
}
