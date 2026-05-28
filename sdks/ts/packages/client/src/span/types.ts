import { type as defineType } from "arktype";
import { SecuritydeptInjectionToken } from "../injection";

export interface SpanCreateOptions {
	idFactory?: () => string;
	attributes?: Record<string, unknown>;
	mutable?: false;
}

export const SpanCreateOptionsSchema = defineType({
	idFactory: "Function",
	attributes: "object",
});

export interface MutableSpanCreateOptions
	extends Omit<SpanCreateOptions, "mutable"> {
	mutable: true;
}

export interface SpanTrait {
	readonly id: string;
	readonly parent?: SpanTrait;
	readonly attributes: Readonly<Record<string, unknown>>;
	fork(options: MutableSpanCreateOptions): MutableSpanTrait;
	fork(options?: SpanCreateOptions): SpanTrait;
	fork(
		options?: SpanCreateOptions | MutableSpanCreateOptions,
	): SpanTrait | MutableSpanTrait;
}

export interface MutableSpanTrait extends SpanTrait {
	setAttributes(attributes: Record<string, unknown>): void;
}

export const SpanTraitSchema = defineType({
	id: "string",
	fork: "Function",
	attributes: "object",
});

export const SPAN_TRAIT_TOKEN = new SecuritydeptInjectionToken<SpanTrait>(
	"SPAN_TRAIT_TOKEN",
);

export interface OperationSpanTrait extends MutableSpanTrait {
	addEvent(type: string, attributes?: Record<string, unknown>): void;
	recordError(error: unknown, attributes?: Record<string, unknown>): void;
}
