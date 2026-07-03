import { type as defineType } from "arktype";
import { SecuritydeptInjectionToken } from "../injection";

export interface SpanCreateOptions {
	idFactory?: () => string;
	attributes?: SpanAttributes;
	mutable?: false;
}

export type SpanAttributeValue =
	| string
	| number
	| boolean
	| null
	| readonly SpanAttributeValue[]
	| { readonly [name: string]: SpanAttributeValue };

export type SpanAttributes = Readonly<Record<string, SpanAttributeValue>>;

export interface SpanAttributeReadOptions {
	providerId: string;
	withShared?: boolean;
}

export interface SpanPathOptions {
	skipSelf?: boolean;
}

export interface SpanNodeAttributes {
	readonly spanId: string;
	readonly parentSpanId?: string;
	readonly attributes: SpanAttributes;
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
	getAttributes(options?: SpanAttributeReadOptions): SpanAttributes;
	getRootToNodePath(options?: SpanPathOptions): readonly SpanTrait[];
	getRootToNodeAttributes(
		options?: SpanPathOptions & { providerId?: string },
	): readonly SpanNodeAttributes[];
	fork(options: MutableSpanCreateOptions): MutableSpanTrait;
	fork(options?: SpanCreateOptions): SpanTrait;
	fork(
		options?: SpanCreateOptions | MutableSpanCreateOptions,
	): SpanTrait | MutableSpanTrait;
}

export interface MutableSpanTrait extends SpanTrait {
	setAttributes(
		attributes: SpanAttributes,
		options?: { providerId?: string },
	): void;
}

export const SpanTraitSchema = defineType({
	id: "string",
	fork: "Function",
	getAttributes: "Function",
	getRootToNodePath: "Function",
	getRootToNodeAttributes: "Function",
});

export const SPAN_TRAIT_TOKEN = new SecuritydeptInjectionToken<SpanTrait>(
	"SPAN_TRAIT_TOKEN",
);
