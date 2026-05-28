import { v7 as uuidv7 } from "uuid";
import {
	type TraitInputValidator,
	throwValidationClientError,
	validateTraitInput,
	type WithTraitInputValidator,
} from "../validation";
import {
	type MutableSpanCreateOptions,
	type MutableSpanTrait,
	type SpanCreateOptions,
	SpanCreateOptionsSchema,
	type SpanTrait,
} from "./types";

function createDefaultSpanId(): string {
	return `span_${uuidv7()}`;
}

class DefaultSpan implements MutableSpanTrait {
	readonly id: string;
	readonly parent: SpanTrait | undefined;
	protected _attributes: Readonly<Record<string, unknown>>;
	protected readonly _idFactory: () => string;

	get attributes() {
		return this._attributes;
	}

	protected constructor(
		parent: SpanTrait | undefined,
		idFactory: () => string,
		attributes: Readonly<Record<string, unknown>>,
	) {
		this._idFactory = idFactory;
		this.id = idFactory();
		this.parent = parent;
		this._attributes = attributes;
	}

	static root(options: SpanCreateOptions = {}): SpanTrait {
		return new DefaultSpan(
			undefined,
			options.idFactory ?? createDefaultSpanId,
			Object.freeze({ ...(options.attributes ?? {}) }),
		);
	}

	fork(options: MutableSpanCreateOptions): MutableSpanTrait;
	fork(options?: SpanCreateOptions): SpanTrait;
	fork(
		options: SpanCreateOptions | MutableSpanCreateOptions = {},
	): SpanTrait | MutableSpanTrait {
		return new DefaultSpan(
			this,
			options.idFactory ?? this._idFactory,
			Object.freeze({ ...options.attributes }),
		);
	}

	setAttributes(attributes: Record<string, unknown>): void {
		this._attributes = Object.freeze({ ...this._attributes, ...attributes });
	}
}

export function createRootSpan(
	options: SpanCreateOptions &
		WithTraitInputValidator<TraitInputValidator> = {},
): SpanTrait {
	const { validators, ...resolvedOptions } = options;
	const resolvedCreateOptions = {
		idFactory: resolvedOptions.idFactory ?? createDefaultSpanId,
		attributes: resolvedOptions.attributes ?? {},
	};
	validateTraitInput({
		value: resolvedCreateOptions,
		bundledSchema: SpanCreateOptionsSchema,
		validator: validators,
		onInvalid: (failure) =>
			throwValidationClientError({
				code: "span.invalid_options",
				source: "span",
				messagePrefix: "createRootSpan could not validate spanCreateOptions",
				failure,
			}),
	});
	return DefaultSpan.root(resolvedCreateOptions);
}
