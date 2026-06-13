import { describe, expect, it, vi } from "vitest";
import {
	createComputed,
	createSignal,
	flattenResourceSnapshot,
	type ResourceSnapshot,
	ResourceStatus,
} from "../../signals/index";

describe("flattenResourceSnapshot", () => {
	it("flattens a resolved snapshot into a selected snapshot signal", () => {
		const selected = createSignal<ResourceSnapshot<string>>({
			status: ResourceStatus.Resolved,
			value: "ready",
		});

		const flattened: ResourceSnapshot<string> = flattenResourceSnapshot(
			{ status: ResourceStatus.Resolved, value: { selected } },
			(value) => value.selected,
		);

		expect(flattened).toEqual({
			status: ResourceStatus.Resolved,
			value: "ready",
		});
	});

	it("tracks the dynamically selected snapshot signal", () => {
		const selected = createSignal<ResourceSnapshot<number>>({
			status: ResourceStatus.Loading,
		});
		const source = createSignal<
			ResourceSnapshot<{ selected: typeof selected }>
		>({ status: ResourceStatus.Resolved, value: { selected } });
		const flattened = createComputed(() =>
			flattenResourceSnapshot(source.get(), (value) => value.selected),
		);

		expect(flattened.get()).toEqual({ status: ResourceStatus.Loading });
		selected.set({ status: ResourceStatus.Resolved, value: 42 });
		expect(flattened.get()).toEqual({
			status: ResourceStatus.Resolved,
			value: 42,
		});
	});

	it("does not select through a snapshot without a value", () => {
		const select = vi.fn(() =>
			createSignal<ResourceSnapshot<string>>({
				status: ResourceStatus.Resolved,
				value: "unused",
			}),
		);

		expect(
			flattenResourceSnapshot({ status: ResourceStatus.Loading }, select),
		).toEqual({ status: ResourceStatus.Loading });
		expect(select).not.toHaveBeenCalled();
	});

	it("preserves ancestor reloading and error states", () => {
		const selected = createSignal<ResourceSnapshot<string>>({
			status: ResourceStatus.Resolved,
			value: "stale",
		});
		const error = new Error("outer failed");

		expect(
			flattenResourceSnapshot(
				{ status: ResourceStatus.Reloading, value: { selected } },
				(value) => value.selected,
			),
		).toEqual({ status: ResourceStatus.Reloading, value: "stale" });
		expect(
			flattenResourceSnapshot(
				{ status: ResourceStatus.Error, value: { selected }, error },
				(value) => value.selected,
			),
		).toEqual({ status: ResourceStatus.Error, value: "stale", error });

		selected.set({ status: ResourceStatus.Loading });
		expect(
			flattenResourceSnapshot(
				{ status: ResourceStatus.Error, value: { selected }, error },
				(value) => value.selected,
			),
		).toEqual({ status: ResourceStatus.LoadingError, error });
	});

	it("infers and flattens four selected levels", () => {
		const fourth = createSignal<ResourceSnapshot<number>>({
			status: ResourceStatus.Resolved,
			value: 4,
		});
		const third = createSignal<ResourceSnapshot<{ next: typeof fourth }>>({
			status: ResourceStatus.Resolved,
			value: { next: fourth },
		});
		const second = createSignal<ResourceSnapshot<{ next: typeof third }>>({
			status: ResourceStatus.Resolved,
			value: { next: third },
		});
		const first = createSignal<ResourceSnapshot<{ next: typeof second }>>({
			status: ResourceStatus.Resolved,
			value: { next: second },
		});

		const flattened: ResourceSnapshot<number> = flattenResourceSnapshot(
			{ status: ResourceStatus.Resolved, value: { next: first } },
			(value) => value.next,
			(value) => value.next,
			(value) => value.next,
			(value) => value.next,
		);

		expect(flattened).toEqual({
			status: ResourceStatus.Resolved,
			value: 4,
		});
	});

	it("supports additional levels through the fallback overload", () => {
		const terminal = createSignal<ResourceSnapshot<number>>({
			status: ResourceStatus.Resolved,
			value: 5,
		});
		const level4 = createSignal<ResourceSnapshot<{ next: typeof terminal }>>({
			status: ResourceStatus.Resolved,
			value: { next: terminal },
		});
		const level3 = createSignal<ResourceSnapshot<{ next: typeof level4 }>>({
			status: ResourceStatus.Resolved,
			value: { next: level4 },
		});
		const level2 = createSignal<ResourceSnapshot<{ next: typeof level3 }>>({
			status: ResourceStatus.Resolved,
			value: { next: level3 },
		});
		const level1 = createSignal<ResourceSnapshot<{ next: typeof level2 }>>({
			status: ResourceStatus.Resolved,
			value: { next: level2 },
		});

		const flattened = flattenResourceSnapshot(
			{ status: ResourceStatus.Resolved, value: { next: level1 } },
			(value) => value.next,
			(value) => value.next,
			(value) => value.next,
			(value) => value.next,
			(value) => value.next,
		);

		expect(flattened).toEqual({
			status: ResourceStatus.Resolved,
			value: 5,
		});
	});
});
