import { describe, expect, it } from "vitest";
import { createCancellationTokenSource } from "../../cancellation/cancellation-token";
import { ClientError } from "../../errors/client-error";
import { readErrorPresentationDescriptor } from "../../errors/presentation-descriptor";
import {
	ClientErrorKind,
	ClientErrorSource,
	ErrorPresentationTone,
	UserRecovery,
} from "../../errors/types";

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

	it("should create from server error body", () => {
		const err = ClientError.fromServerError({
			code: "auth_required",
			message: "Please login",
			recovery: UserRecovery.Reauthenticate,
		});
		expect(err.code).toBe("auth_required");
		expect(err.recovery).toBe(UserRecovery.Reauthenticate);
		expect(err.presentation?.code).toBe("auth_required");
		expect(err.presentation?.recovery).toBe(UserRecovery.Reauthenticate);
	});

	it("should create from 500 HTTP response", () => {
		const err = ClientError.fromHttpResponse(500, { message: "Internal" });
		expect(err.kind).toBe(ClientErrorKind.Server);
		expect(err.retryable).toBe(true);
		expect(err.recovery).toBe(UserRecovery.Retry);
	});

	it("should classify structured 500 error body as server, not protocol", () => {
		const err = ClientError.fromHttpResponse(500, {
			code: "db_unavailable",
			message: "Database connection failed",
			recovery: UserRecovery.Retry,
		});
		expect(err.kind).toBe(ClientErrorKind.Server);
		expect(err.source).toBe(ClientErrorSource.Server);
		expect(err.code).toBe("db_unavailable");
		expect(err.presentation?.code).toBe("db_unavailable");
	});

	it("should consume a structured server error envelope", () => {
		const err = ClientError.fromHttpResponse(503, {
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

	it("should create from 401 HTTP response", () => {
		const err = ClientError.fromHttpResponse(401);
		expect(err.kind).toBe(ClientErrorKind.Unauthenticated);
		expect(err.recovery).toBe(UserRecovery.Reauthenticate);
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
		const descriptor = readErrorPresentationDescriptor(
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
			title: "Popup login was closed",
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
			kind: ClientErrorKind.Unauthenticated,
			title: "Authentication required",
			description: "Login required",
			recovery: UserRecovery.Reauthenticate,
			primaryAction: {
				recovery: UserRecovery.Reauthenticate,
				label: "Sign in again",
				href: null,
			},
		});
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
		cts.token.onCancellationRequested((reason) => {
			received = reason;
		});
		cts.cancel("gone");
		expect(received).toBe("gone");
	});

	it("should invoke listener immediately if already cancelled", () => {
		const cts = createCancellationTokenSource();
		cts.cancel("early");
		let received: unknown;
		cts.token.onCancellationRequested((reason) => {
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
