import type { TelemetryTrait } from "../../environment/types";
import type { EnvironmentValidators } from "../../environment/validators";
import { validateEnvTraitInput } from "../../environment/validators";
import { createOperationTracer } from "../../logging/operation-tracer";
import type { TimeTrait } from "../../scheduling/types";
import type { SpanContextHostTrait } from "../../span/types";

export interface CreateTelemetryForStdOptions {
	logger?: TelemetryTrait["logger"];
	traceSink?: TelemetryTrait["traceSink"];
	operationTracer?: TelemetryTrait["operationTracer"];
	time?: Pick<TimeTrait, "now">;
	spanContext?: SpanContextHostTrait;
	validators?: Pick<EnvironmentValidators, "telemetry">;
}

export function createTelemetryForStd(
	options: CreateTelemetryForStdOptions = {},
): TelemetryTrait {
	validateEnvTraitInput({
		traitName: "telemetry",
		hostAdapter: "createTelemetryForStd",
		value: options,
		validator: options.validators?.telemetry,
		bundleValidate: (value) => {
			const input = value as CreateTelemetryForStdOptions;
			return (
				(input.logger === undefined ||
					typeof input.logger.log === "function") &&
				(input.traceSink === undefined ||
					typeof input.traceSink.record === "function") &&
				(input.operationTracer === undefined ||
					typeof input.operationTracer.startOperation === "function")
			);
		},
	});
	return {
		logger: options.logger,
		traceSink: options.traceSink,
		operationTracer:
			options.operationTracer ??
			createOperationTracer({
				time: options.time,
				logger: options.logger,
				traceSink: options.traceSink,
				spanContext: options.spanContext,
			}),
	};
}
