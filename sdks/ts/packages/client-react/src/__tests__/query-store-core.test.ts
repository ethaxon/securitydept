import { RxEventSubject } from "@securitydept/client/rx";
import { createTimeForTest } from "@securitydept/client/test";
import { describe, expect, it, vi } from "vitest";
import {
	QueryObserver,
	QueryResultStatus,
	type QuerySource,
	QueryStore,
} from "../query-store";

class TestQuerySource<T> implements QuerySource<T> {
	readonly input = new RxEventSubject<T>();
	readonly cancel = vi.fn();
}

describe("QueryStore", () => {
	it("shares a generic query, pending operation, and source subscription", async () => {
		const time = createTimeForTest();
		const source = new TestQuerySource<string>();
		const subscribe = vi.spyOn(source.input, "subscribe");
		const store = new QueryStore({ time });
		const sourceFactory = vi.fn(() => source);
		const options = {
			hash: "generic-query",
			source: sourceFactory,
		};
		const first = new QueryObserver(store, options);
		const second = new QueryObserver(store, options);

		const firstResult = first.getSnapshot();
		const secondResult = second.getSnapshot();
		expect(firstResult.status).toBe(QueryResultStatus.Pending);
		expect(secondResult).toBe(firstResult);
		expect(sourceFactory).toHaveBeenCalledOnce();
		expect(subscribe).toHaveBeenCalledOnce();

		const firstListener = vi.fn();
		const secondListener = vi.fn();
		const unsubscribeFirst = first.subscribe(firstListener);
		const unsubscribeSecond = second.subscribe(secondListener);
		expect(subscribe).toHaveBeenCalledOnce();

		source.input.next("ready");
		if (firstResult.status !== QueryResultStatus.Pending) {
			throw new TypeError("Expected a pending query.");
		}
		await expect(firstResult.promise).resolves.toBe("ready");
		expect(first.getSnapshot()).toEqual({
			status: QueryResultStatus.Resolved,
			value: "ready",
		});
		expect(firstListener).toHaveBeenCalledOnce();
		expect(secondListener).toHaveBeenCalledOnce();
		source.input.next("ignored");
		expect(first.getSnapshot()).toEqual({
			status: QueryResultStatus.Resolved,
			value: "ready",
		});

		unsubscribeFirst();
		unsubscribeSecond();
		store.dispose();
		expect(source.cancel).toHaveBeenCalledOnce();
	});

	it("accepts promise and iterable query inputs directly", async () => {
		const store = new QueryStore({ time: createTimeForTest() });
		const cancelPromise = vi.fn();
		const promiseObserver = new QueryObserver(store, {
			hash: "promise-query",
			source: () => ({
				cancel: cancelPromise,
				input: Promise.resolve("promise-value"),
			}),
		});
		const pending = promiseObserver.getSnapshot();
		expect(pending.status).toBe(QueryResultStatus.Pending);
		if (pending.status !== QueryResultStatus.Pending) {
			throw new TypeError("Expected a pending promise query.");
		}
		await expect(pending.promise).resolves.toBe("promise-value");
		expect(promiseObserver.getSnapshot()).toEqual({
			status: QueryResultStatus.Resolved,
			value: "promise-value",
		});

		const iterableObserver = new QueryObserver(store, {
			hash: "iterable-query",
			source: () => ({
				cancel: vi.fn(),
				input: ["first", "last"],
			}),
		});
		const iterablePending = iterableObserver.getSnapshot();
		expect(iterablePending.status).toBe(QueryResultStatus.Pending);
		if (iterablePending.status !== QueryResultStatus.Pending) {
			throw new TypeError("Expected a pending iterable query.");
		}
		await expect(iterablePending.promise).resolves.toBe("first");
		expect(iterableObserver.getSnapshot()).toEqual({
			status: QueryResultStatus.Resolved,
			value: "first",
		});

		store.dispose();
		expect(cancelPromise).toHaveBeenCalledOnce();
	});

	it("reactively cancels and restarts garbage collection with subscribers", async () => {
		const time = createTimeForTest();
		const cancel = vi.fn();
		const store = new QueryStore({ time, gcTimeMs: 100 });
		const observer = new QueryObserver(store, {
			hash: "gc-query",
			source: () => ({ cancel, input: Promise.resolve("ready") }),
		});
		const pending = observer.getSnapshot();
		if (pending.status !== QueryResultStatus.Pending) {
			throw new TypeError("Expected a pending query.");
		}
		await pending.promise;

		const unsubscribeFirst = observer.subscribe(() => undefined);
		unsubscribeFirst();
		expect(time.pendingCount).toBe(1);
		time.advance(50);

		const unsubscribeSecond = observer.subscribe(() => undefined);
		expect(time.pendingCount).toBe(0);
		time.advanceAndFlush(100);
		expect(cancel).not.toHaveBeenCalled();

		unsubscribeSecond();
		expect(time.pendingCount).toBe(1);
		time.advanceAndFlush(100);
		expect(cancel).toHaveBeenCalledOnce();
		expect(time.pendingCount).toBe(0);
	});
});
