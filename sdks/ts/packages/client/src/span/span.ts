import { v7 as uuidv7 } from "uuid";
import {
	type TraitInputValidator,
	throwValidationClientError,
	validateTraitInput,
	type WithTraitInputValidator,
} from "../validation";
import {
	type SpanCreateOptions,
	SpanCreateOptionsSchema,
	type SpanTrait,
} from "./types";

function createDefaultSpanId(): string {
	return uuidv7();
}

class DefaultSpan implements SpanTrait {
	readonly id: string;
	readonly parent: SpanTrait | undefined;
	readonly attributes: Readonly<Record<string, unknown>>;
	private readonly _idFactory: () => string;

	private constructor(
		parent: SpanTrait | undefined,
		idFactory: () => string,
		attributes: Readonly<Record<string, unknown>>,
	) {
		this._idFactory = idFactory;
		this.id = idFactory();
		this.parent = parent;
		this.attributes = attributes;
	}

	static root(options: SpanCreateOptions = {}): SpanTrait {
		return new DefaultSpan(
			undefined,
			options.idFactory ?? createDefaultSpanId,
			Object.freeze({ ...(options.attributes ?? {}) }),
		);
	}

	fork(options: SpanCreateOptions = {}): SpanTrait {
		return new DefaultSpan(
			this,
			options.idFactory ?? this._idFactory,
			Object.freeze({ ...(options.attributes ?? {}) }),
		);
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
