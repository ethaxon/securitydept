import { type as defineType } from "arktype";
import { SecuritydeptInjectionToken } from "../injection";
import {
	type TraitInputValidator,
	type WithTraitInputValidator,
} from "../validation";

export interface SpanCreateOptions {
	idFactory?: () => string;
	attributes?: Record<string, unknown>;
}

export const SpanCreateOptionsSchema = defineType({
	idFactory: "Function",
	attributes: "object",
});

export interface SpanTrait {
	readonly id: string;
	readonly parent?: SpanTrait;
	readonly attributes: Readonly<Record<string, unknown>>;
	fork(
		options?: SpanCreateOptions & WithTraitInputValidator<TraitInputValidator>,
	): SpanTrait;
}

export const SpanTraitSchema = defineType({
	id: "string",
	fork: "Function",
	attributes: "object",
});

export const SPAN_TRAIT_TOKEN = new SecuritydeptInjectionToken<SpanTrait>(
	"SPAN_TRAIT_TOKEN",
);

export interface OperationSpanTrait extends SpanTrait {
	addEvent(type: string, attributes?: Record<string, unknown>): void;
	setAttribute(key: string, value: unknown): void;
	recordError(error: unknown, attributes?: Record<string, unknown>): void;
}
