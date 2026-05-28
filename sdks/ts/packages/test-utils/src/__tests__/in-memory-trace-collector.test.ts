import {
	createRootSpan,
	OperationTraceEventType,
	TracingLevel,
} from "@securitydept/client";
import { describe, expect, it } from "vitest";
import { InMemoryTraceCollector } from "../in-memory-trace-collector";

describe("InMemoryTraceCollector", () => {
	it("filters events by operation id and asserts lifecycle sequence", () => {
		const collector = new InMemoryTraceCollector();
		const root = createRootSpan({ idFactory: () => "root" });
		const op1 = root.fork({ idFactory: () => "op_1" });
		const op2 = root.fork({ idFactory: () => "op_2" });

		collector.record({
			name: OperationTraceEventType.Started,
			at: 1,
			span: op1,
			level: TracingLevel.Info,
			target: "trace-test",
		});
		collector.record({
			name: "domain.callback.started",
			at: 2,
			span: op1,
			level: TracingLevel.Info,
			target: "trace-test",
		});
		collector.record({
			name: OperationTraceEventType.Event,
			at: 3,
			span: op1,
			level: TracingLevel.Info,
			target: "trace-test",
		});
		collector.record({
			name: OperationTraceEventType.Error,
			at: 4,
			span: op1,
			level: TracingLevel.Error,
			target: "trace-test",
		});
		collector.record({
			name: OperationTraceEventType.Ended,
			at: 5,
			span: op1,
			level: TracingLevel.Info,
			target: "trace-test",
		});
		collector.record({
			name: OperationTraceEventType.Started,
			at: 6,
			span: op2,
			level: TracingLevel.Info,
			target: "trace-test",
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
		const root = createRootSpan({ idFactory: () => "root" });
		const bad = root.fork({ idFactory: () => "op_bad" });
		collector.record({
			name: OperationTraceEventType.Started,
			at: 1,
			span: bad,
			level: TracingLevel.Info,
			target: "trace-test",
		});
		collector.record({
			name: OperationTraceEventType.Ended,
			at: 2,
			span: bad,
			level: TracingLevel.Info,
			target: "trace-test",
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
