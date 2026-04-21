import { OperationTraceEventType } from "@securitydept/client";
import { describe, expect, it } from "vitest";
import { InMemoryTraceCollector } from "../in-memory-trace-collector";

describe("InMemoryTraceCollector", () => {
	it("filters events by operation id and asserts lifecycle sequence", () => {
		const collector = new InMemoryTraceCollector();

		collector.record({
			type: OperationTraceEventType.Started,
			at: 1,
			operationId: "op_1",
		});
		collector.record({
			type: "frontend_oidc.callback.started",
			at: 2,
			operationId: "op_1",
		});
		collector.record({
			type: OperationTraceEventType.Event,
			at: 3,
			operationId: "op_1",
		});
		collector.record({
			type: OperationTraceEventType.Error,
			at: 4,
			operationId: "op_1",
		});
		collector.record({
			type: OperationTraceEventType.Ended,
			at: 5,
			operationId: "op_1",
		});
		collector.record({
			type: OperationTraceEventType.Started,
			at: 6,
			operationId: "op_2",
		});

		expect(collector.ofOperation("op_1")).toHaveLength(5);
		expect(
			collector.assertOperationLifecycle("op_1", [
				OperationTraceEventType.Started,
				OperationTraceEventType.Event,
				OperationTraceEventType.Error,
				OperationTraceEventType.Ended,
			]),
		).toHaveLength(4);
	});

	it("throws when lifecycle sequence does not match", () => {
		const collector = new InMemoryTraceCollector();
		collector.record({
			type: OperationTraceEventType.Started,
			at: 1,
			operationId: "op_bad",
		});
		collector.record({
			type: OperationTraceEventType.Ended,
			at: 2,
			operationId: "op_bad",
		});

		expect(() =>
			collector.assertOperationLifecycle("op_bad", [
				OperationTraceEventType.Started,
				OperationTraceEventType.Event,
				OperationTraceEventType.Ended,
			]),
		).toThrow(/Operation lifecycle mismatch/);
	});
});
