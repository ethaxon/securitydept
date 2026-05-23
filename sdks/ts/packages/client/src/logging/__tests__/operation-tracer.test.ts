import { describe, expect, it, vi } from "vitest";
import { createSpan } from "../../span/span";
import { createSpanContextHostForTest } from "../../span/test";
import { createOperationTracer } from "../operation-tracer";
import { OperationTraceEventType, type TraceEvent } from "../types";

describe("operation tracer", () => {
	it("records started, event, error, and ended lifecycle entries with one operation id", () => {
		const events: TraceEvent[] = [];
		const tracer = createOperationTracer({
			time: { now: () => Date.parse("2026-01-01T00:00:00Z") },
			idFactory: () => "op_fixed",
			traceSink: {
				record(event) {
					events.push(event);
				},
			},
		});

		const operation = tracer.startOperation("frontend-oidc.callback", {
			flow: "callback",
		});
		operation.setAttribute("mode", "frontend");
		operation.addEvent("pending.state.loaded", { state: "s1" });
		operation.recordError(new Error("boom"), { phase: "exchange" });
		operation.end({ result: "failed" });
		operation.end({ result: "ignored" });

		expect(events.map((event) => event.type)).toEqual([
			OperationTraceEventType.Started,
			OperationTraceEventType.Event,
			OperationTraceEventType.Error,
			OperationTraceEventType.Ended,
		]);
		expect(new Set(events.map((event) => event.operationId))).toEqual(
			new Set(["op_fixed"]),
		);
		expect(events[1]).toMatchObject({
			attributes: {
				operationName: "frontend-oidc.callback",
				flow: "callback",
				mode: "frontend",
				eventType: "pending.state.loaded",
				state: "s1",
			},
		});
		expect(events[2]).toMatchObject({
			attributes: {
				phase: "exchange",
				errorName: "Error",
				errorMessage: "boom",
			},
		});
	});

	it("uses logger only as a human-readable auxiliary channel for error recording", () => {
		const log = vi.fn();
		const tracer = createOperationTracer({
			idFactory: () => "op_logger",
			logger: { log },
		});

		const operation = tracer.startOperation("backend-oidc.refresh");
		operation.recordError(new Error("refresh failed"), { retryable: false });

		expect(log).toHaveBeenCalledWith(
			expect.objectContaining({
				level: "error",
				message: "Operation failed: backend-oidc.refresh",
				attributes: expect.objectContaining({
					operationId: "op_logger",
					operationName: "backend-oidc.refresh",
					retryable: false,
				}),
			}),
		);
	});

	it("forks spans from the current span context", async () => {
		const events: TraceEvent[] = [];
		const spanContext = createSpanContextHostForTest();
		const rootSpan = createSpan({
			idFactory: () => "span_root",
		});
		const tracer = createOperationTracer({
			time: { now: () => Date.parse("2026-01-01T00:00:00Z") },
			idFactory: () => "op_child",
			spanContext,
			traceSink: {
				record(event) {
					events.push(event);
				},
			},
		});

		await spanContext.runWithSpan(rootSpan, async () => {
			const operation = tracer.startOperation("token.refresh");
			operation.end({ result: "ok" });
		});

		expect(events[0]).toMatchObject({
			type: OperationTraceEventType.Started,
			operationId: "op_child",
			spanId: "op_child",
			parentSpanId: "span_root",
		});
	});
});
