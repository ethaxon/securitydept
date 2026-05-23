export interface ForkSpanOptions {
	idFactory?: () => string;
	attributes?: Record<string, unknown>;
}

export interface CreateSpanOptions extends ForkSpanOptions {
	parentSpan?: SpanTrait;
}

export interface SpanTrait {
	readonly id: string;
	readonly parentId?: string;
	fork(options?: ForkSpanOptions): SpanTrait;
	addAttributes(attributes: Record<string, unknown>): void;
	recordError(error: unknown): void;
	end(outcome?: Record<string, unknown>): void;
}

export interface SpanContextHostTrait {
	currentSpan(): SpanTrait | undefined;
	runWithSpan<T>(span: SpanTrait, fn: () => T): T;
	runWithSpan<T>(span: SpanTrait, fn: () => Promise<T>): Promise<T>;
}
