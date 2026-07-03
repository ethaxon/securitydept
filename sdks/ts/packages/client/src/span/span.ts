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
	type SpanAttributeReadOptions,
	type SpanAttributes,
	type SpanCreateOptions,
	SpanCreateOptionsSchema,
	type SpanNodeAttributes,
	type SpanPathOptions,
	type SpanTrait,
} from "./types";

function createDefaultSpanId(): string {
	return `span_${uuidv7()}`;
}

class DefaultSpan implements MutableSpanTrait {
	readonly id: string;
	readonly parent: SpanTrait | undefined;
	protected _sharedAttributes: SpanAttributes;
	protected readonly _providerAttributes = new Map<string, SpanAttributes>();
	protected readonly _idFactory: () => string;

	protected constructor(
		parent: SpanTrait | undefined,
		idFactory: () => string,
		attributes: SpanAttributes,
	) {
		this._idFactory = idFactory;
		this.id = idFactory();
		this.parent = parent;
		this._sharedAttributes = attributes;
	}

	static root(options: SpanCreateOptions = {}): SpanTrait {
		return new DefaultSpan(
			undefined,
			options.idFactory ?? createDefaultSpanId,
			{ ...(options.attributes ?? {}) },
		);
	}

	fork(options: MutableSpanCreateOptions): MutableSpanTrait;
	fork(options?: SpanCreateOptions): SpanTrait;
	fork(
		options: SpanCreateOptions | MutableSpanCreateOptions = {},
	): SpanTrait | MutableSpanTrait {
		return new DefaultSpan(this, options.idFactory ?? this._idFactory, {
			...options.attributes,
		});
	}

	getAttributes(options?: SpanAttributeReadOptions): SpanAttributes {
		if (!options) {
			return this._sharedAttributes;
		}

		const providerAttributes =
			this._providerAttributes.get(options.providerId) ?? {};
		if (options.withShared === false) {
			return providerAttributes;
		}
		return {
			...this._sharedAttributes,
			...providerAttributes,
		};
	}

	getRootToNodePath(options: SpanPathOptions = {}): readonly SpanTrait[] {
		const path: SpanTrait[] = [];
		let current: SpanTrait | undefined = options.skipSelf ? this.parent : this;
		while (current) {
			path.push(current);
			current = current.parent;
		}
		return path.reverse();
	}

	getRootToNodeAttributes(
		options: SpanPathOptions & { providerId?: string } = {},
	): readonly SpanNodeAttributes[] {
		const path = this.getRootToNodePath({ skipSelf: options.skipSelf });
		const frames: SpanNodeAttributes[] = [];
		for (const span of path) {
			const attributes =
				options.providerId !== undefined
					? span.getAttributes({ providerId: options.providerId })
					: span.getAttributes();
			if (Object.keys(attributes).length === 0) {
				continue;
			}
			frames.push({
				spanId: span.id,
				...(span.parent ? { parentSpanId: span.parent.id } : {}),
				attributes,
			});
		}
		return frames;
	}

	setAttributes(
		attributes: SpanAttributes,
		options: { providerId?: string } = {},
	): void {
		if (options.providerId === undefined) {
			this._sharedAttributes = {
				...this._sharedAttributes,
				...attributes,
			};
			return;
		}

		this._providerAttributes.set(options.providerId, {
			...this._providerAttributes.get(options.providerId),
			...attributes,
		});
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
