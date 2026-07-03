import { type SpanTrait } from "../span/types";
import {
	ClientErrorKind,
	ClientErrorSource,
	type ClientErrorSpanContext,
	type ServerErrorPresentation,
	UserRecovery,
	type UserRecovery as UserRecoveryType,
} from "./types";

export const CLIENT_ERROR_SPAN_ATTRIBUTE_PROVIDER_ID =
	"@securitydept/client/error";

type ServerErrorBody = {
	kind?: string;
	code?: string;
	message?: string;
	recovery?: string;
	presentation?: {
		code?: string;
		message?: string;
		recovery?: string;
	};
};

export interface ClientErrorFromUnknownOptions {
	message: string;
	code: string;
	source: string;
	span?: SpanTrait;
}

export interface ClientErrorFromHttpResponseOptions {
	status: number;
	body?: unknown;
	source?: string;
	span?: SpanTrait;
}

const userRecoveryValues = new Set<string>(Object.values(UserRecovery));

function readUserRecovery(value: unknown): UserRecoveryType | undefined {
	return typeof value === "string" && userRecoveryValues.has(value)
		? (value as UserRecoveryType)
		: undefined;
}

function mapServerErrorKind(
	kind: string | undefined,
	status: number,
): ClientErrorKind {
	switch (kind) {
		case "unauthenticated":
			return ClientErrorKind.Unauthenticated;
		case "unauthorized":
			return ClientErrorKind.Unauthorized;
		case "unavailable":
		case "internal":
			return ClientErrorKind.Server;
		case "invalid_request":
		case "conflict":
			return ClientErrorKind.Protocol;
		default:
			return status === 401
				? ClientErrorKind.Unauthenticated
				: status === 403
					? ClientErrorKind.Unauthorized
					: status === 408
						? ClientErrorKind.Timeout
						: status >= 500
							? ClientErrorKind.Server
							: ClientErrorKind.Protocol;
	}
}

function readServerErrorBody(body: unknown): ServerErrorBody | undefined {
	if (!body || typeof body !== "object") {
		return undefined;
	}
	const record = body as Record<string, unknown>;
	const error =
		record.error && typeof record.error === "object"
			? (record.error as Record<string, unknown>)
			: record;

	return {
		kind: typeof error.kind === "string" ? error.kind : undefined,
		code: typeof error.code === "string" ? error.code : undefined,
		message: typeof error.message === "string" ? error.message : undefined,
		recovery: typeof error.recovery === "string" ? error.recovery : undefined,
		presentation:
			error.presentation && typeof error.presentation === "object"
				? {
						code:
							typeof (error.presentation as Record<string, unknown>).code ===
							"string"
								? ((error.presentation as Record<string, unknown>)
										.code as string)
								: undefined,
						message:
							typeof (error.presentation as Record<string, unknown>).message ===
							"string"
								? ((error.presentation as Record<string, unknown>)
										.message as string)
								: undefined,
						recovery:
							typeof (error.presentation as Record<string, unknown>)
								.recovery === "string"
								? ((error.presentation as Record<string, unknown>)
										.recovery as string)
								: undefined,
					}
				: undefined,
	};
}

/**
 * Base client error carrying both machine-facing context and an optional
 * user-facing presentation layer.
 *
 * Top-level `code` and `recovery` provide stable machine contracts for
 * policy decisions without requiring callers to unwrap `presentation`.
 */
export class ClientError extends Error {
	private _spanContext: ClientErrorSpanContext | undefined;

	readonly kind: ClientErrorKind;

	/**
	 * Stable machine-readable error code.
	 * Matches `presentation.code` when present, otherwise a default
	 * derived from `kind`.
	 */
	readonly code: string;

	/** Recovery hint at the machine level. */
	readonly recovery: UserRecoveryType;

	/** Whether this error is safe to retry. */
	readonly retryable: boolean;

	/** Structured user-facing error presentation from the server. */
	readonly presentation?: ServerErrorPresentation;

	/** Source subsystem or component that produced the error. */
	readonly source?: string;

	get spanContext(): ClientErrorSpanContext | undefined {
		return this._spanContext;
	}

	constructor(options: {
		kind: ClientErrorKind;
		message: string;
		code?: string;
		recovery?: UserRecoveryType;
		retryable?: boolean;
		presentation?: ServerErrorPresentation;
		source?: string;
		cause?: unknown;
		span?: SpanTrait;
	}) {
		super(options.message, { cause: options.cause });
		this.name = "ClientError";
		this.kind = options.kind;
		this.code =
			options.code ?? options.presentation?.code ?? `client.${options.kind}`;
		this.recovery =
			options.recovery ?? options.presentation?.recovery ?? UserRecovery.None;
		this.retryable = options.retryable ?? this.recovery === UserRecovery.Retry;
		this.presentation = options.presentation;
		this.source = options.source;
		if (options.span) {
			this.captureSpanContext(options.span);
		}
	}

	captureSpanContext(span: SpanTrait): this {
		this._spanContext ??= span.getRootToNodeAttributes({
			providerId: CLIENT_ERROR_SPAN_ATTRIBUTE_PROVIDER_ID,
		});
		return this;
	}

	/** Create a `ClientError` from a server error response body. */
	static fromServerError(
		body: {
			kind?: string;
			code?: string;
			message?: string;
			recovery?: string;
			presentation?: {
				code?: string;
				message?: string;
				recovery?: string;
			};
		},
		overrides?: {
			kind?: ClientErrorKind;
			source?: string;
			span?: SpanTrait;
		},
	): ClientError {
		const rawPresentation = body.presentation;
		const recovery =
			readUserRecovery(body.recovery) ??
			readUserRecovery(rawPresentation?.recovery) ??
			UserRecovery.None;
		const presentation: ServerErrorPresentation | undefined =
			rawPresentation?.code && rawPresentation.message
				? {
						code: rawPresentation.code,
						message: rawPresentation.message,
						recovery: readUserRecovery(rawPresentation.recovery) ?? recovery,
					}
				: undefined;

		return new ClientError({
			kind: overrides?.kind ?? mapServerErrorKind(body.kind, 400),
			message: body.message ?? presentation?.message ?? "Unknown server error",
			code: body.code ?? presentation?.code,
			recovery,
			retryable: recovery === UserRecovery.Retry,
			presentation,
			source: overrides?.source,
			span: overrides?.span,
		});
	}

	static fromUnknown(
		error: unknown,
		options: ClientErrorFromUnknownOptions,
	): ClientError {
		if (error instanceof ClientError) {
			return options.span ? error.captureSpanContext(options.span) : error;
		}

		return new ClientError({
			kind: ClientErrorKind.Internal,
			message: options.message,
			code: options.code,
			source: options.source,
			cause: error,
			span: options.span,
		});
	}

	/**
	 * Create a `ClientError` from an HTTP response status and optional body.
	 * Used when a non-success status is unexpected.
	 */
	static fromHttpResponse(
		options: ClientErrorFromHttpResponseOptions,
	): ClientError {
		const { status, body } = options;
		const serverBody = readServerErrorBody(body);

		// Derive kind and source from HTTP status first — these apply
		// whether or not the response carries a structured error body.
		const kind = mapServerErrorKind(serverBody?.kind, status);

		const source = options.source ?? ClientErrorSource.Server;
		const fallbackRecovery: UserRecoveryType =
			kind === ClientErrorKind.Unauthenticated
				? UserRecovery.Reauthenticate
				: status === 408 || status >= 500
					? UserRecovery.Retry
					: UserRecovery.None;

		// If the server returned a structured error body, preserve it
		// but keep the status-derived kind/source.
		if (serverBody?.code && serverBody?.message) {
			const recovery =
				readUserRecovery(serverBody.presentation?.recovery) ??
				readUserRecovery(serverBody.recovery) ??
				fallbackRecovery;
			return ClientError.fromServerError(
				{
					...serverBody,
					recovery,
					presentation: serverBody.presentation
						? { ...serverBody.presentation, recovery }
						: undefined,
				},
				{ kind, source, span: options.span },
			);
		}

		return new ClientError({
			kind,
			message: serverBody?.message ?? `HTTP ${status}`,
			code: serverBody?.code ?? `http.${status}`,
			recovery: fallbackRecovery,
			retryable: status === 408 || status >= 500,
			source,
			span: options.span,
		});
	}
}
