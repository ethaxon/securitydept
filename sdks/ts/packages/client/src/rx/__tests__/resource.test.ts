import { from, of, Subject, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import {
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
		const resource = rxResource({
			stream: () => of("ready"),
		});

		expect(resource.status.get()).toBe(ResourceStatus.Resolved);
		expect(resource.value.get()).toBe("ready");
		expect(resource.hasValue()).toBe(true);

		resource.dispose();
	});

	it("creates a resource from SDK event stream input", () => {
		const resource = createResource({
			stream: () =>
				createEventStream<string>((observer) => {
					observer.next("ready");
				}),
		});

		expect(resource.status.get()).toBe(ResourceStatus.Resolved);
		expect(resource.value.get()).toBe("ready");

		resource.dispose();
	});

	it("emits snapshots through interop observable", () => {
		const response = new Subject<string>();
		const resource = rxResource({
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
		resource.dispose();
	});

	it("waits for the first available resource value", async () => {
		const response = new Subject<string>();
		const resource = rxResource({
			stream: () => response,
		});
		const pending = resource.whenValue();

		response.next("ready");

		await expect(pending).resolves.toBe("ready");
		resource.dispose();
	});

	it("rejects when waiting resource enters error status", async () => {
		const error = new Error("failed");
		const resource = rxResource<string>({
			stream: () => throwError(() => error),
		});

		await expect(resource.whenValue()).rejects.toBe(error);
		resource.dispose();
	});

	it("supports cancellation while waiting for a resource value", async () => {
		const response = new Subject<string>();
		const resource = rxResource({
			stream: () => response,
		});
		const cancellation = createCancellationTokenSource();
		const pending = resource.whenValue({
			cancellationToken: cancellation.token,
		});

		cancellation.cancel(new Error("cancelled"));

		await expect(pending).rejects.toThrow("cancelled");
		resource.dispose();
	});

	it("keeps the previous value while reloading", () => {
		const request = createSignal("first");
		const response = new Subject<string>();
		const resource = rxResource({
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

		resource.dispose();
	});

	it("throws when reading value while no value is available", () => {
		const response = new Subject<string>();
		const resource = rxResource<string>({
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

		resource.dispose();
	});

	it("captures stream errors", () => {
		const error = new Error("failed");
		const resource = rxResource<string>({
			stream: () => throwError(() => error),
		});

		expect(resource.status.get()).toBe(ResourceStatus.LoadingError);
		expect(resource.error.get()).toBe(error);
		expect(resource.snapshot.get()).toEqual({
			status: ResourceStatus.LoadingError,
			error,
		});
		expect(() => resource.value.get()).toThrow(error);

		resource.dispose();
	});

	it("retries from loading error without inventing a fallback value", () => {
		const request = createSignal("first");
		const error = new Error("failed");
		const resource = rxResource({
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

		resource.dispose();
	});

	it("keeps the last resolved value when a reload fails", () => {
		const request = createSignal("first");
		const error = new Error("failed");
		const resource = rxResource({
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

		resource.dispose();
	});

	it("reloads when the request signal changes", () => {
		const request = createSignal("first");
		const resource = rxResource({
			request,
			stream: ({ request }) => of(`value:${request}`),
		});

		expect(resource.value.get()).toBe("value:first");
		request.set("second");

		expect(resource.value.get()).toBe("value:second");

		resource.dispose();
	});

	it("stops loading after dispose", () => {
		const request = createSignal("first");
		const stream = vi.fn(({ request }) => of(`value:${request}`));
		const resource = rxResource({
			request,
			stream,
		});

		resource.dispose();
		resource.dispose();
		request.set("second");

		expect(stream).toHaveBeenCalledTimes(1);
		expect(resource.value.get()).toBe("value:first");
	});

	it("keeps an undefined request idle", () => {
		const request = createSignal<string | undefined>(undefined);
		const stream = vi.fn(() => of("ready"));
		const resource = rxResource({
			request,
			stream,
		});

		expect(resource.snapshot.get()).toEqual({ status: ResourceStatus.Idle });
		expect(stream).not.toHaveBeenCalled();

		request.set("load");
		expect(resource.value.get()).toBe("ready");
		resource.dispose();
	});

	it("projects a snapshot signal without copying state", () => {
		const snapshot = RxStateSignal.fromInitialValue<
			import("../../index").ResourceSnapshot<number>
		>({ status: ResourceStatus.Idle });
		const resource = resourceFromSnapshots(() => snapshot.get());
		const mapped = mapResource(resource, (value) => `value:${value}`);
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

		mapped.dispose();
		resource.dispose();
	});

	it("rejects pending whenValue when disposed", async () => {
		const response = new Subject<string>();
		const resource = rxResource({
			stream: () => response,
		});
		const pending = resource.whenValue();

		resource.dispose();

		await expect(pending).rejects.toMatchObject({
			code: ResourceErrorCode.Disposed,
		});
	});
});
