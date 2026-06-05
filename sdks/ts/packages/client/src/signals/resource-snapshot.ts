import { type ResourceSnapshot, ResourceStatus } from "./types";

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

export function resourceSnapshotValueOr<T>(
	snapshot: ResourceSnapshot<T>,
	unavailableValue: T,
): T {
	return snapshot.status === ResourceStatus.Reloading ||
		snapshot.status === ResourceStatus.Resolved ||
		snapshot.status === ResourceStatus.Error
		? snapshot.value
		: unavailableValue;
}
