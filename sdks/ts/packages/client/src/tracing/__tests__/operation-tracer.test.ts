import { type as defineType } from "arktype";
import { describe, expect, it } from "vitest";
import { createFoundationEnvironment } from "../../environment/create";
import { createRootSpan } from "../../span";
import { createTracing } from "../create";
import { defineInstrumentMethodDecorator } from "../operation-method";
import { OperationSpan, runOperation } from "../operation-runner";
import {
	OperationTraceEventType,
	TRACING_SPAN_ATTRIBUTE_PROVIDER_ID,
	type TracingEvent,
	TracingLevel,
} from "../types";

describe("createTracing", () => {
	it("records events to both the runtime stream and configured subscribers", () => {
		const recorded: TracingEvent[] = [];
		const streamed: TracingEvent[] = [];
		const tracing = createTracing({
			subscribers: [
				{
					record(event: TracingEvent) {
						recorded.push(event);
					},
				},
			],
		});
		const event: TracingEvent = {
			name: "operation.started",
			at: 1,
			target: "test",
			level: TracingLevel.Info,
			span: createRootSpan({ idFactory: () => "trace_span" }),
		};

		tracing.events.subscribe({
			next(nextEvent) {
				streamed.push(nextEvent);
			},
		});
		tracing.record(event);

		expect(recorded).toEqual([event]);
		expect(streamed).toEqual([event]);
	});

	it("does not replay old events to late subscribers", () => {
		const streamed: TracingEvent[] = [];
		const tracing = createTracing();
		const span = createRootSpan({ idFactory: () => "late_span" });

		tracing.record({
			name: "operation.started",
			at: 1,
			target: "test",
			level: TracingLevel.Info,
			span,
		});
		tracing.events.subscribe({
			next(event) {
				streamed.push(event);
			},
		});
		tracing.record({
			name: "operation.ended",
			at: 2,
			target: "test",
			level: TracingLevel.Info,
			span,
		});

		expect(streamed).toEqual([
			expect.objectContaining({
				name: "operation.ended",
			}),
		]);
	});

	it("uses caller-provided validators for tracing constructor options", () => {
		expect(() =>
			createTracing({
				validators: defineType({
					subscribers: "0",
				}),
				subscribers: [],
			}),
		).toThrow(/tracingCreateOptions/);
	});
});

function createRecordingEnvironment(events: TracingEvent[]) {
	return createFoundationEnvironment({
		transport: {
			async execute() {
				throw new Error("unexpected transport call");
			},
		},
		span: createRootSpan({ idFactory: () => "root_span" }),
		tracing: createTracing({
			subscribers: [
				{
					record(event: TracingEvent) {
						events.push(event);
					},
				},
			],
		}),
		time: {
			now: () => Date.parse("2026-01-01T00:00:00Z"),
			setTimeout() {
				throw new Error("createRecordingEnvironment.setTimeout() is not used.");
			},
			clearTimeout() {},
		},
	});
}

describe("runOperation", () => {
	it("supports manually managed operation lifecycles", () => {
		const events: TracingEvent[] = [];
		const environment = createRecordingEnvironment(events);
		const operationSpan = OperationSpan.start({
			environment,
			span: environment.span,
			name: "manual.workflow",
			target: "manual-test",
			idFactory: () => "manual_span",
		});

		operationSpan.setTraceAttributes({ phase: "committed" });
		operationSpan.recordEnded("succeeded");

		expect(events.map((event) => event.name)).toEqual([
			OperationTraceEventType.Started,
			OperationTraceEventType.Ended,
		]);
		expect(events.every((event) => event.span.id === "manual_span")).toBe(true);
		expect(events[1]).toMatchObject({
			fields: { outcome: "succeeded" },
		});
		expect(
			events[1]?.span.getRootToNodeAttributes({
				providerId: TRACING_SPAN_ATTRIBUTE_PROVIDER_ID,
			}),
		).toContainEqual(
			expect.objectContaining({
				attributes: {
					"operation.name": "manual.workflow",
					phase: "committed",
				},
			}),
		);
	});

	it("uses the parent span id factory by default", () => {
		const events: TracingEvent[] = [];
		let nextId = 0;
		const environment = createFoundationEnvironment({
			transport: {
				async execute() {
					throw new Error("unexpected transport call");
				},
			},
			span: createRootSpan({
				idFactory() {
					nextId += 1;
					return `span_${nextId.toString()}`;
				},
			}),
			tracing: createTracing({
				subscribers: [
					{
						record(event: TracingEvent) {
							events.push(event);
						},
					},
				],
			}),
			time: {
				now: () => Date.parse("2026-01-01T00:00:00Z"),
				setTimeout() {
					throw new Error(
						"createRecordingEnvironment.setTimeout() is not used.",
					);
				},
				clearTimeout() {},
			},
		});

		runOperation({
			environment,
			span: environment.span,
			name: "frontend_oidc.default_id",
			target: "frontend-oidc-mode",
			execute: () => undefined,
		});

		expect(events[0]?.span).toMatchObject({
			id: "span_2",
			parent: expect.objectContaining({ id: "span_1" }),
		});
	});

	it("records lifecycle events on one forked operation span", () => {
		const events: TracingEvent[] = [];
		const environment = createRecordingEnvironment(events);

		runOperation({
			environment,
			span: environment.span,
			name: "frontend_oidc.callback",
			target: "frontend-oidc-mode",
			traceAttributes: { flow: "callback" },
			idFactory: () => "op_fixed",
			execute: (span) => {
				span.setTraceAttributes({ mode: "frontend" });
				span.addEvent("pending.state.loaded", { state: "s1" });
				span.recordError(new Error("boom"), { phase: "exchange" });
			},
		});

		expect(events.map((event) => event.name)).toEqual([
			OperationTraceEventType.Started,
			OperationTraceEventType.Event,
			OperationTraceEventType.Error,
			OperationTraceEventType.Ended,
		]);
		expect(events.every((event) => event.target === "frontend-oidc-mode")).toBe(
			true,
		);
		expect(events.every((event) => event.span.id === "op_fixed")).toBe(true);
		expect(events[0]).toMatchObject({
			level: TracingLevel.Info,
			span: expect.objectContaining({
				id: "op_fixed",
				parent: expect.objectContaining({
					id: "root_span",
				}),
			}),
		});
		expect(events[1]).toMatchObject({
			fields: {
				eventName: "pending.state.loaded",
				state: "s1",
			},
		});
		expect(events[2]).toMatchObject({
			level: TracingLevel.Error,
			fields: expect.objectContaining({
				phase: "exchange",
				errorName: "Error",
			}),
		});
		expect(events[3]).toMatchObject({
			level: TracingLevel.Info,
			fields: { outcome: "succeeded" },
		});
		expect(
			events[3]?.span.getAttributes({
				providerId: TRACING_SPAN_ATTRIBUTE_PROVIDER_ID,
			}),
		).toEqual({
			"operation.name": "frontend_oidc.callback",
			flow: "callback",
			mode: "frontend",
		});
	});

	it("records error and failed outcome when the operation rejects", async () => {
		const events: TracingEvent[] = [];
		const environment = createRecordingEnvironment(events);

		await expect(
			runOperation({
				environment,
				span: environment.span,
				name: "token.refresh",
				target: "frontend-oidc-mode",
				idFactory: () => "op_failure",
				execute: async () => {
					throw new Error("boom");
				},
			}),
		).rejects.toThrow("boom");

		expect(events.map((event) => event.name)).toEqual([
			OperationTraceEventType.Started,
			OperationTraceEventType.Error,
			OperationTraceEventType.Ended,
		]);
		expect(events[1]).toMatchObject({
			level: TracingLevel.Error,
			fields: expect.objectContaining({
				errorName: "Error",
			}),
		});
		expect(events[2]).toMatchObject({
			level: TracingLevel.Error,
			fields: { outcome: "failed" },
		});
	});
});

describe("defineInstrumentMethodDecorator", () => {
	it("wraps async methods through runOperation", async () => {
		const events: TracingEvent[] = [];
		const environment = createRecordingEnvironment(events);

		class DecoratedBase {
			readonly environment = environment;
		}

		const instrumentMethod = defineInstrumentMethodDecorator<
			[prefix: string],
			DecoratedBase
		>(
			({ factoryArgs: [prefix], methodName }) =>
				function (this: DecoratedBase, { args }) {
					return {
						environment: this.environment,
						span: this.environment.span,
						name: `${prefix}.${methodName}`,
						target: "decorator-test",
						traceAttributes: {
							tag: String(args[0]),
						},
					};
				},
		);

		class DecoratedClient extends DecoratedBase {
			@instrumentMethod("resolved")
			async execute(tag: string): Promise<string> {
				return `done:${tag}`;
			}
		}

		const client = new DecoratedClient();
		await expect(client.execute("alpha")).resolves.toBe("done:alpha");

		expect(events.map((event) => event.name)).toEqual([
			OperationTraceEventType.Started,
			OperationTraceEventType.Ended,
		]);
		expect(events[0]).toMatchObject({
			target: "decorator-test",
			span: expect.objectContaining({
				parent: expect.objectContaining({
					id: "root_span",
				}),
			}),
		});
		expect(events[1]).toMatchObject({
			target: "decorator-test",
			fields: { outcome: "succeeded" },
		});
		expect(
			events[1]?.span.getAttributes({
				providerId: TRACING_SPAN_ATTRIBUTE_PROVIDER_ID,
			}),
		).toEqual({ "operation.name": "resolved.execute", tag: "alpha" });
	});

	it("records error lifecycle for decorated methods", async () => {
		const events: TracingEvent[] = [];
		const environment = createRecordingEnvironment(events);

		class DecoratedBase {
			readonly environment = environment;
		}

		const instrumentFailure = defineInstrumentMethodDecorator<
			[],
			DecoratedBase
		>(
			() =>
				function (this: DecoratedBase) {
					return {
						environment: this.environment,
						span: this.environment.span,
						name: "decorated.failure",
						target: "decorator-test",
					};
				},
		);

		class DecoratedClient extends DecoratedBase {
			@instrumentFailure()
			async fail(): Promise<void> {
				throw new Error("decorated boom");
			}
		}

		const client = new DecoratedClient();
		await expect(client.fail()).rejects.toThrow("decorated boom");

		expect(events.map((event) => event.name)).toEqual([
			OperationTraceEventType.Started,
			OperationTraceEventType.Error,
			OperationTraceEventType.Ended,
		]);
		expect(events[1]).toMatchObject({
			target: "decorator-test",
			level: TracingLevel.Error,
			fields: expect.objectContaining({
				errorName: "Error",
			}),
		});
		expect(events[2]).toMatchObject({
			target: "decorator-test",
			level: TracingLevel.Error,
			fields: { outcome: "failed" },
		});
	});
});
