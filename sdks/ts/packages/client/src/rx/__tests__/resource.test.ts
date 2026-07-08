import { from, of, Subject, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import {
	type CancellationTokenTrait,
	createCancellationTokenSource,
	createEventStream,
	createResource,
	createSignal,
	mapResource,
	ResourceError,
	ResourceErrorCode,
	ResourceStatus,
	resourceFromSnapshots,
} from "../../index";
import { RxStateSignal, rxResource } from "../index";

describe("@securitydept/client/rx/resource", () => {
	it("loads an observable value into the resource snapshot", () => {
		using resource = rxResource({
			stream: () => of("ready"),
		});

		expect(resource.status.get()).toBe(ResourceStatus.Resolved);
		expect(resource.value.get()).toBe("ready");
		expect(resource.hasValue()).toBe(true);
	});

	it("creates a resource from SDK event stream input", () => {
		using resource = createResource({
			stream: () =>
				createEventStream<string>((observer) => {
					observer.next("ready");
				}),
		});

		expect(resource.status.get()).toBe(ResourceStatus.Resolved);
		expect(resource.value.get()).toBe("ready");
	});

	it("emits snapshots through interop observable", () => {
		const response = new Subject<string>();
		using resource = rxResource({
			stream: () => response,
		});
		const snapshots: unknown[] = [];
		const subscription = from(resource).subscribe((snapshot) => {
			snapshots.push(snapshot);
		});

		response.next("ready");

		expect(snapshots).toEqual([
			{ status: ResourceStatus.Loading },
			{ status: ResourceStatus.Resolved, value: "ready" },
		]);

		subscription.unsubscribe();
	});

	it("waits for the first available resource value", async () => {
		const response = new Subject<string>();
		using resource = rxResource({
			stream: () => response,
		});
		const pending = resource.whenValue();

		response.next("ready");

		await expect(pending).resolves.toBe("ready");
	});

	it("rejects when waiting resource enters error status", async () => {
		const error = new Error("failed");
		using resource = rxResource<string>({
			stream: () => throwError(() => error),
		});

		await expect(resource.whenValue()).rejects.toBe(error);
	});

	it("returns stale error values unless strict error handling is requested", async () => {
		const error = new Error("refresh failed");
		const snapshot = createSignal({
			status: ResourceStatus.Error,
			value: "stale",
			error,
		} as const);
		using resource = resourceFromSnapshots(() => snapshot.get());

		await expect(resource.whenValue()).resolves.toBe("stale");
		await expect(
			resource.whenValue({ staleValueWhenError: false }),
		).rejects.toBe(error);
	});

	it("supports cancellation while waiting for a resource value", async () => {
		const response = new Subject<string>();
		using resource = rxResource({
			stream: () => response,
		});
		const cancellation = createCancellationTokenSource();
		const pending = resource.whenValue({
			cancellationToken: cancellation.token,
		});

		cancellation.cancel(new Error("cancelled"));

		await expect(pending).rejects.toThrow("cancelled");
	});

	it("keeps the previous value while reloading", () => {
		const request = createSignal("first");
		const response = new Subject<string>();
		using resource = rxResource({
			request,
			stream: () => response,
		});

		response.next("first value");
		request.set("second");
		expect(resource.snapshot.get()).toEqual({
			status: ResourceStatus.Reloading,
			value: "first value",
		});
		expect(resource.isLoading.get()).toBe(true);

		response.next("fresh");
		expect(resource.snapshot.get()).toEqual({
			status: ResourceStatus.Resolved,
			value: "fresh",
		});
	});

	it("throws when reading value while no value is available", () => {
		const response = new Subject<string>();
		using resource = rxResource<string>({
			stream: () => response,
		});

		expect(resource.status.get()).toBe(ResourceStatus.Loading);
		try {
			resource.value.get();
			throw new Error("Expected resource value read to fail.");
		} catch (error) {
			expect(error).toBeInstanceOf(ResourceError);
			expect((error as ResourceError).code).toBe(
				ResourceErrorCode.ValueUnavailable,
			);
			expect((error as ResourceError).status).toBe(ResourceStatus.Loading);
		}
	});

	it("captures stream errors", () => {
		const error = new Error("failed");
		using resource = rxResource<string>({
			stream: () => throwError(() => error),
		});

		expect(resource.status.get()).toBe(ResourceStatus.LoadingError);
		expect(resource.error.get()).toBe(error);
		expect(resource.snapshot.get()).toEqual({
			status: ResourceStatus.LoadingError,
			error,
		});
		expect(() => resource.value.get()).toThrow(error);
	});

	it("retries from loading error without inventing a fallback value", () => {
		const request = createSignal("first");
		const error = new Error("failed");
		using resource = rxResource({
			request,
			stream: ({ request }) =>
				request === "first" ? throwError(() => error) : of("ready"),
		});

		expect(resource.snapshot.get()).toEqual({
			status: ResourceStatus.LoadingError,
			error,
		});
		request.set("second");
		expect(resource.snapshot.get()).toEqual({
			status: ResourceStatus.Resolved,
			value: "ready",
		});
	});

	it("keeps the last resolved value when a reload fails", () => {
		const request = createSignal("first");
		const error = new Error("failed");
		using resource = rxResource({
			request,
			stream: ({ request }) =>
				request === "first" ? of("cached") : throwError(() => error),
		});

		request.set("second");
		expect(resource.snapshot.get()).toEqual({
			status: ResourceStatus.Error,
			value: "cached",
			error,
		});
		expect(() => resource.value.get()).toThrow(error);
	});

	it("reloads when the request signal changes", () => {
		const request = createSignal("first");
		using resource = rxResource({
			request,
			stream: ({ request }) => of(`value:${request}`),
		});

		expect(resource.value.get()).toBe("value:first");
		request.set("second");

		expect(resource.value.get()).toBe("value:second");
	});

	it("keeps an undefined request idle", () => {
		const request = createSignal<string | undefined>(undefined);
		const stream = vi.fn(() => of("ready"));
		using resource = rxResource({
			request,
			stream,
		});

		expect(resource.snapshot.get()).toEqual({ status: ResourceStatus.Idle });
		expect(stream).not.toHaveBeenCalled();

		request.set("load");
		expect(resource.value.get()).toBe("ready");
	});

	it("projects a snapshot signal without copying or owning source state", () => {
		const snapshot = RxStateSignal.fromInitialValue<
			import("../../index").ResourceSnapshot<number>
		>({ status: ResourceStatus.Idle });
		using resource = resourceFromSnapshots(() => snapshot.get());
		{
			using mapped = mapResource(resource, (value) => `value:${value}`);
			const loadingError = new Error("initial load failed");

			snapshot.set({
				status: ResourceStatus.LoadingError,
				error: loadingError,
			});
			expect(mapped.snapshot.get()).toEqual({
				status: ResourceStatus.LoadingError,
				error: loadingError,
			});

			snapshot.set({ status: ResourceStatus.Resolved, value: 2 });
			expect(resource.value.get()).toBe(2);
			expect(mapped.value.get()).toBe("value:2");

			const error = new Error("failed");
			snapshot.set({ status: ResourceStatus.Error, value: 2, error });
			expect(mapped.snapshot.get()).toEqual({
				status: ResourceStatus.Error,
				value: "value:2",
				error,
			});
			expect(() => mapped.value.get()).toThrow(error);
		}

		snapshot.set({ status: ResourceStatus.Resolved, value: 3 });
		expect(resource.value.get()).toBe(3);
	});

	it("cancels a pending load when disposed", async () => {
		const response = new Subject<string>();
		let cancellationToken: CancellationTokenTrait | undefined;
		{
			using resource = rxResource({
				stream: (context) => {
					cancellationToken = context.cancellationToken;
					return response;
				},
			});
			void resource.whenValue();
		}
		await Promise.resolve();

		expect(response.observed).toBe(false);
		expect(cancellationToken?.isCancellationRequested).toBe(true);
	});
});
