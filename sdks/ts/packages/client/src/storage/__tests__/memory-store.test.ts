import { describe, expect, it } from "vitest";
import { createInMemoryRecordStore } from "../memory-store";
import {
	type StorageChangeEvent,
	StorageChangeEventOrigin,
	type StorageTrait,
} from "../types";

describe("in-memory record storage", () => {
	it("is synchronously assignable to StorageTrait", () => {
		const storage: StorageTrait = createInMemoryRecordStore();

		expect(storage.get("missing")).toBeNull();
	});

	it("emits logical changes for set, take, and remove", () => {
		const storage = createInMemoryRecordStore();
		const events: StorageChangeEvent[] = [];
		const subscription = storage.storageEvent?.subscribe({
			next: (event) => events.push(event),
		});

		storage.set("flow", "first");
		storage.set("flow", "second");
		expect(storage.take?.("flow")).toBe("second");
		storage.set("other", "value");
		storage.remove("other");

		expect(events).toEqual([
			{
				origin: StorageChangeEventOrigin.Local,
				key: "flow",
				oldValue: null,
				newValue: "first",
			},
			{
				origin: StorageChangeEventOrigin.Local,
				key: "flow",
				oldValue: "first",
				newValue: "second",
			},
			{
				origin: StorageChangeEventOrigin.Local,
				key: "flow",
				oldValue: "second",
				newValue: null,
			},
			{
				origin: StorageChangeEventOrigin.Local,
				key: "other",
				oldValue: null,
				newValue: "value",
			},
			{
				origin: StorageChangeEventOrigin.Local,
				key: "other",
				oldValue: "value",
				newValue: null,
			},
		]);
		subscription?.unsubscribe();
	});
});
