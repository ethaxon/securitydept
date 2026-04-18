import {
	ClientErrorKind,
	ClientErrorSource,
	type ErrorPresentation,
	UserRecovery,
	type UserRecovery as UserRecoveryType,
} from "./types";

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
					: status >= 500
						? ClientErrorKind.Server
						: ClientErrorKind.Protocol;
	}
}

function readServerErrorBody(body: unknown): ServerErrorBody | undefined {
	if (!body || typeof body !== "object") return undefined;
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
	readonly presentation?: ErrorPresentation;

	/** Source subsystem or component that produced the error. */
	readonly source?: string;

	constructor(options: {
		kind: ClientErrorKind;
		message: string;
		code?: string;
		recovery?: UserRecoveryType;
		retryable?: boolean;
		presentation?: ErrorPresentation;
		source?: string;
		cause?: unknown;
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
		overrides?: { kind?: ClientErrorKind; source?: string },
	): ClientError {
		const rawPresentation = body.presentation;
		const presentation: ErrorPresentation | undefined =
			(rawPresentation?.code ?? body.code) &&
			(rawPresentation?.message ?? body.message)
				? {
						code: rawPresentation?.code ?? body.code ?? "unknown_server_error",
						message:
							rawPresentation?.message ??
							body.message ??
							"Unknown server error",
						recovery:
							(rawPresentation?.recovery as ErrorPresentation["recovery"]) ??
							(body.recovery as ErrorPresentation["recovery"]) ??
							UserRecovery.None,
					}
				: undefined;

		return new ClientError({
			kind: overrides?.kind ?? mapServerErrorKind(body.kind, 400),
			message: presentation?.message ?? body.message ?? "Unknown server error",
			presentation,
			source: overrides?.source,
		});
	}

	/**
	 * Create a `ClientError` from an HTTP response status and optional body.
	 * Used when a non-success status is unexpected.
	 */
	static fromHttpResponse(status: number, body?: unknown): ClientError {
		const serverBody = readServerErrorBody(body);

		// Derive kind and source from HTTP status first — these apply
		// whether or not the response carries a structured error body.
		const kind = mapServerErrorKind(serverBody?.kind, status);

		const source =
			status >= 500
				? ClientErrorSource.Server
				: ClientErrorSource.ClientRuntime;

		// If the server returned a structured error body, preserve it
		// but keep the status-derived kind/source.
		if (serverBody?.code && serverBody?.message) {
			return ClientError.fromServerError(serverBody, { kind, source });
		}

		const recovery: UserRecoveryType =
			kind === ClientErrorKind.Unauthenticated
				? UserRecovery.Reauthenticate
				: status >= 500
					? UserRecovery.Retry
					: UserRecovery.None;

		return new ClientError({
			kind,
			message: serverBody?.message ?? `HTTP ${status}`,
			code: serverBody?.code ?? `http.${status}`,
			recovery,
			retryable: status >= 500,
			source,
		});
	}
}
