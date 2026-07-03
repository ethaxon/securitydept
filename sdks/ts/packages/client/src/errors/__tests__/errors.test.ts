import { describe, expect, it } from "vitest";
import { createCancellationTokenSource } from "../../cancellation/create";
import {
	CLIENT_ERROR_SPAN_ATTRIBUTE_PROVIDER_ID,
	ClientError,
} from "../../errors/client-error";
import { describeError } from "../../errors/error-attributes";
import { readErrorPresentationDescriptor } from "../../errors/presentation-descriptor";
import {
	ClientErrorKind,
	ClientErrorSource,
	ErrorPresentationTone,
	UserRecovery,
} from "../../errors/types";
import { readPopupErrorPresentationDescriptor } from "../../popup/errors";
import { SpanSharedAttributeName } from "../../span/attributes";
import { createRootSpan } from "../../span/span";
import { TRACING_SPAN_ATTRIBUTE_PROVIDER_ID } from "../../tracing/types";

describe("ClientError", () => {
	it("should create with kind and message", () => {
		const err = new ClientError({
			kind: ClientErrorKind.Transport,
			message: "Network down",
		});
		expect(err.kind).toBe(ClientErrorKind.Transport);
		expect(err.message).toBe("Network down");
		expect(err.name).toBe("ClientError");
	});

	it("should default code from kind", () => {
		const err = new ClientError({
			kind: ClientErrorKind.Protocol,
			message: "Bad",
		});
		expect(err.code).toBe("client.protocol");
		expect(err.recovery).toBe(UserRecovery.None);
		expect(err.retryable).toBe(false);
	});

	it("should preserve cause", () => {
		const cause = new Error("root");
		const err = new ClientError({
			kind: ClientErrorKind.Internal,
			message: "Wrapper",
			cause,
		});
		expect(err.cause).toBe(cause);
	});

	it("wraps unknown errors and preserves their cause", () => {
		const cause = new TypeError("secret detail");
		const error = ClientError.fromUnknown(cause, {
			code: "test.operation_failed",
			message: "The test operation failed",
			source: "test",
		});
		expect(error).toMatchObject({
			kind: ClientErrorKind.Internal,
			code: "test.operation_failed",
			source: "test",
			cause,
		});
	});

	it("captures the first error-oriented span path without changing identity", () => {
		class SpecificClientError extends ClientError {}
		const root = createRootSpan({
			idFactory: () => "root",
			attributes: {
				[SpanSharedAttributeName.ClientName]: "SessionContextClient",
				[SpanSharedAttributeName.ClientId]: "session-client",
			},
		});
		const operation = root.fork({
			mutable: true,
			idFactory: () => "operation",
			attributes: {
				[SpanSharedAttributeName.OperationName]: "session_context.refresh",
			},
		});
		operation.setAttributes(
			{ endpointKind: "user_info" },
			{ providerId: CLIENT_ERROR_SPAN_ATTRIBUTE_PROVIDER_ID },
		);
		operation.setAttributes(
			{ traceSecret: "trace-only" },
			{ providerId: TRACING_SPAN_ATTRIBUTE_PROVIDER_ID },
		);
		const error = new SpecificClientError({
			kind: ClientErrorKind.Server,
			message: "Request failed",
		});

		expect(error.captureSpanContext(operation)).toBe(error);
		expect(error).toBeInstanceOf(SpecificClientError);
		expect(error.spanContext).toEqual([
			{
				spanId: "root",
				attributes: {
					[SpanSharedAttributeName.ClientName]: "SessionContextClient",
					[SpanSharedAttributeName.ClientId]: "session-client",
				},
			},
			{
				spanId: "operation",
				parentSpanId: "root",
				attributes: {
					[SpanSharedAttributeName.OperationName]: "session_context.refresh",
					endpointKind: "user_info",
				},
			},
		]);
		expect(JSON.stringify(error.spanContext)).not.toContain("trace-only");

		const other = root.fork({
			attributes: {
				[SpanSharedAttributeName.OperationName]: "outer.operation",
			},
		});
		error.captureSpanContext(other);
		expect(error.spanContext?.at(-1)?.spanId).toBe("operation");
	});

	it("should create from server error body", () => {
		const err = ClientError.fromServerError({
			code: "auth_required",
			message: "Please login",
			recovery: UserRecovery.Reauthenticate,
		});
		expect(err.code).toBe("auth_required");
		expect(err.recovery).toBe(UserRecovery.Reauthenticate);
		expect(err.presentation).toBeUndefined();
	});

	it("should create from 500 HTTP response", () => {
		const err = ClientError.fromHttpResponse({
			status: 500,
			body: { message: "Internal" },
		});
		expect(err.kind).toBe(ClientErrorKind.Server);
		expect(err.retryable).toBe(true);
		expect(err.recovery).toBe(UserRecovery.Retry);
	});

	it("should classify structured 500 error body as server, not protocol", () => {
		const err = ClientError.fromHttpResponse({
			status: 500,
			body: {
				code: "db_unavailable",
				message: "Database connection failed",
				recovery: UserRecovery.Retry,
			},
		});
		expect(err.kind).toBe(ClientErrorKind.Server);
		expect(err.source).toBe(ClientErrorSource.Server);
		expect(err.code).toBe("db_unavailable");
		expect(err.presentation).toBeUndefined();
	});

	it("should consume a structured server error envelope", () => {
		const err = ClientError.fromHttpResponse({
			status: 503,
			body: {
				success: false,
				status: 503,
				error: {
					kind: "unavailable",
					code: "service_unavailable",
					message: "The service is temporarily unavailable.",
					recovery: UserRecovery.ContactSupport,
					retryable: false,
					presentation: {
						code: "service_unavailable",
						message: "The service is temporarily unavailable.",
						recovery: UserRecovery.ContactSupport,
					},
				},
			},
		});

		expect(err.kind).toBe(ClientErrorKind.Server);
		expect(err.source).toBe(ClientErrorSource.Server);
		expect(err.code).toBe("service_unavailable");
		expect(err.recovery).toBe(UserRecovery.ContactSupport);
		expect(err.presentation).toMatchObject({
			code: "service_unavailable",
			message: "The service is temporarily unavailable.",
			recovery: UserRecovery.ContactSupport,
		});
	});

	it("ignores unsupported server recovery values", () => {
		const err = ClientError.fromHttpResponse({
			status: 500,
			body: {
				code: "service_unavailable",
				message: "The service is temporarily unavailable.",
				recovery: "execute_shell",
			},
		});

		expect(err.recovery).toBe(UserRecovery.Retry);
		expect(err.presentation).toBeUndefined();
	});

	it("should create from 401 HTTP response", () => {
		const err = ClientError.fromHttpResponse({ status: 401 });
		expect(err.kind).toBe(ClientErrorKind.Unauthenticated);
		expect(err.recovery).toBe(UserRecovery.Reauthenticate);
	});

	it.each([
		[403, ClientErrorKind.Unauthorized, UserRecovery.None],
		[408, ClientErrorKind.Timeout, UserRecovery.Retry],
		[422, ClientErrorKind.Protocol, UserRecovery.None],
	])("maps HTTP %i to %s", (status, kind, recovery) => {
		expect(ClientError.fromHttpResponse({ status })).toMatchObject({
			kind,
			recovery,
			source: ClientErrorSource.Server,
		});
	});

	it("should preserve source and retryable", () => {
		const err = new ClientError({
			kind: ClientErrorKind.Transport,
			message: "Timeout",
			source: "http",
			retryable: true,
		});
		expect(err.source).toBe("http");
		expect(err.retryable).toBe(true);
	});

	it("builds a host-facing descriptor for popup errors", () => {
		const descriptor = readPopupErrorPresentationDescriptor(
			new ClientError({
				kind: ClientErrorKind.Authorization,
				code: "popup.closed_by_user",
				message: "Popup window was closed before completing the login flow.",
				recovery: UserRecovery.RestartFlow,
			}),
			{
				recoveryLinks: {
					[UserRecovery.RestartFlow]: "/playground/token-set/frontend-mode",
				},
			},
		);

		expect(descriptor).toMatchObject({
			code: "popup.closed_by_user",
			title: "Popup was closed",
			recovery: UserRecovery.RestartFlow,
			tone: ErrorPresentationTone.Warning,
			primaryAction: {
				recovery: UserRecovery.RestartFlow,
				label: "Restart flow",
				href: "/playground/token-set/frontend-mode",
			},
		});
	});

	it("builds a host-facing descriptor for reauthentication errors", () => {
		const descriptor = readErrorPresentationDescriptor(
			new ClientError({
				kind: ClientErrorKind.Unauthenticated,
				message: "Login required",
				code: "authentication_required",
				recovery: UserRecovery.Reauthenticate,
			}),
		);

		expect(descriptor).toMatchObject({
			code: "authentication_required",
			title: "Authentication required",
			description: "Sign in again to continue.",
			recovery: UserRecovery.Reauthenticate,
			primaryAction: {
				recovery: UserRecovery.Reauthenticate,
				label: "Sign in again",
				href: null,
			},
		});
	});

	it("uses the safe fallback for structurally similar non-ClientError values", () => {
		expect(
			readErrorPresentationDescriptor({
				kind: ClientErrorKind.Server,
				code: "server.fake",
				message: "not a ClientError",
			}),
		).toEqual({
			code: null,
			title: "Operation failed",
			description:
				"An unexpected error prevented the operation from completing.",
			recovery: UserRecovery.None,
			tone: ErrorPresentationTone.Danger,
			primaryAction: null,
		});
	});

	it("formats default and host-defined presentation from span context", () => {
		const span = createRootSpan({
			attributes: {
				[SpanSharedAttributeName.ClientName]: "SessionContextClient",
				[SpanSharedAttributeName.OperationName]: "session_context.refresh",
			},
		});
		const error = new ClientError({
			kind: ClientErrorKind.Server,
			message: "Request failed",
			span,
		});

		expect(readErrorPresentationDescriptor(error).title).toBe(
			"SessionContextClient · session_context.refresh: Server request failed",
		);
		expect(
			readErrorPresentationDescriptor(error, {
				contextFormatter: () => "Localized",
			}).title,
		).toBe("Localized: Server request failed");
		expect(
			readErrorPresentationDescriptor(error, { contextFormatter: null }).title,
		).toBe("Server request failed");
	});
});

describe("describeError", () => {
	it("describes ClientError with stable machine fields", () => {
		expect(
			describeError(
				new ClientError({
					kind: ClientErrorKind.Unauthenticated,
					code: "authentication_required",
					message: "Login required",
					recovery: UserRecovery.Reauthenticate,
				}),
			),
		).toEqual({
			errorName: "ClientError",
			errorKind: ClientErrorKind.Unauthenticated,
			errorCode: "authentication_required",
			recovery: UserRecovery.Reauthenticate,
		});
	});

	it("describes native Error values", () => {
		expect(describeError(new TypeError("Wrong type"))).toEqual({
			errorName: "TypeError",
		});
	});

	it("describes unknown thrown values", () => {
		expect(describeError("bad")).toEqual({ errorName: "string" });
	});

	it("does not expose runtime messages through presentation or telemetry", () => {
		const secret = "SECRET_SENTINEL";
		const error = ClientError.fromHttpResponse({
			status: 422,
			body: {
				code: "test.secret",
				message: secret,
			},
		});
		expect(error.presentation).toBeUndefined();
		expect(
			JSON.stringify(readErrorPresentationDescriptor(error)),
		).not.toContain(secret);
		expect(JSON.stringify(describeError(error))).not.toContain(secret);
	});
});

describe("CancellationTokenSource", () => {
	it("should not be cancelled initially", () => {
		const cts = createCancellationTokenSource();
		expect(cts.token.isCancellationRequested).toBe(false);
	});

	it("should become cancelled after cancel()", () => {
		const cts = createCancellationTokenSource();
		cts.cancel("test reason");
		expect(cts.token.isCancellationRequested).toBe(true);
		expect(cts.token.reason).toBe("test reason");
	});

	it("should invoke listener on cancel", () => {
		const cts = createCancellationTokenSource();
		let received: unknown;
		cts.token.onCancellationRequested(({ reason }) => {
			received = reason;
		});
		cts.cancel("gone");
		expect(received).toBe("gone");
	});

	it("should invoke listener immediately if already cancelled", () => {
		const cts = createCancellationTokenSource();
		cts.cancel("early");
		let received: unknown;
		cts.token.onCancellationRequested(({ reason }) => {
			received = reason;
		});
		expect(received).toBe("early");
	});

	it("should throw on throwIfCancellationRequested", () => {
		const cts = createCancellationTokenSource();
		cts.cancel();
		expect(() => cts.token.throwIfCancellationRequested()).toThrow(ClientError);
	});
});
