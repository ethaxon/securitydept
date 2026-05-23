import type { CreateSpanOptions, ForkSpanOptions, SpanTrait } from "./types";

function createDefaultSpanId(): string {
	return `span_${Math.random().toString(36).slice(2, 10)}`;
}

class DefaultSpan implements SpanTrait {
	readonly id: string;
	readonly parentId: string | undefined;

	private _ended = false;
	private readonly _attributes: Record<string, unknown>;

	constructor(options: CreateSpanOptions = {}) {
		this.id = (options.idFactory ?? createDefaultSpanId)();
		this.parentId = options.parentSpan?.id;
		this._attributes = { ...(options.attributes ?? {}) };
	}

	fork(options: ForkSpanOptions = {}): SpanTrait {
		return createSpan({
			parentSpan: this,
			idFactory: options.idFactory,
			attributes: options.attributes,
		});
	}

	addAttributes(attributes: Record<string, unknown>): void {
		Object.assign(this._attributes, attributes);
	}

	recordError(error: unknown): void {
		void error;
	}

	end(outcome?: Record<string, unknown>): void {
		if (this._ended) {
			return;
		}
		this._ended = true;
		void outcome;
	}
}

export function createSpan(options: CreateSpanOptions = {}): SpanTrait {
	return new DefaultSpan(options);
}
