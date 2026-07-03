import {
	ClientError,
	ClientErrorKind,
	createCancellationTokenSource,
	ResourceStatus,
} from "@securitydept/client";
import { createEnvironmentForTest } from "@securitydept/client/test";
import { describe, expect, it, vi } from "vitest";
import { OidcModeCallbackHandler } from "../callback-handler";
import { OidcModeCallbackHandlingKind } from "../types";

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

function createHandler(options: {
	inputResolver: (options: {
		cancellationToken: ReturnType<
			typeof createCancellationTokenSource
		>["token"];
	}) => string | null | Promise<string | null>;
	handleInput?: (input: string) => Promise<string>;
}) {
	const rootCancellation = createCancellationTokenSource();
	const environment = createEnvironmentForTest();
	const handler = new OidcModeCallbackHandler<string, string>({
		environment,
		span: environment.span,
		operationName: "test.callback",
		rootCancellationToken: rootCancellation.token,
		inputResolver: options.inputResolver,
		handleInput:
			options.handleInput ?? (async (input: string) => `handled:${input}`),
		createInputNotFoundError: () =>
			new ClientError({
				kind: ClientErrorKind.Protocol,
				code: "test.callback.input_not_found",
				message: "Callback input not found.",
				source: "test",
			}),
		clientErrorFromUnknown: (error, { span }) =>
			ClientError.fromUnknown(error, {
				code: "test.callback.failed",
				message: "Callback failed.",
				source: "test",
				span,
			}),
	});
	return { handler, rootCancellation };
}

describe("OidcModeCallbackHandler", () => {
	it("publishes not-applicable when the resolver declines the callback", async () => {
		const { handler } = createHandler({ inputResolver: () => null });

		await expect(handler.restore()).resolves.toEqual({
			kind: OidcModeCallbackHandlingKind.NotApplicable,
		});
		expect(handler.state.get()).toEqual({
			status: ResourceStatus.Resolved,
			value: { kind: OidcModeCallbackHandlingKind.NotApplicable },
		});
	});

	it("shares the active restore executor and allows a later explicit callback", async () => {
		const input = createDeferred<string | null>();
		const handleInput = vi.fn(async (value: string) => `handled:${value}`);
		const { handler } = createHandler({
			inputResolver: () => input.promise,
			handleInput,
		});

		const first = handler.restore();
		const second = handler.restore();
		expect(second).toBe(first);
		expect(handler.state.get()).toEqual({ status: ResourceStatus.Loading });

		input.resolve("redirect");
		await expect(first).resolves.toEqual({
			kind: OidcModeCallbackHandlingKind.Handled,
			result: "handled:redirect",
		});
		await expect(handler.handle({ input: "popup" })).resolves.toBe(
			"handled:popup",
		);
		expect(handleInput).toHaveBeenCalledTimes(2);
	});

	it("cancels only the active callback executor", async () => {
		const { handler, rootCancellation } = createHandler({
			inputResolver: ({ cancellationToken }) =>
				new Promise((_resolve, reject) => {
					cancellationToken.onCancellationRequested(({ cancellationError }) =>
						reject(cancellationError),
					);
				}),
		});

		const execution = handler.restore();
		handler.cancel();

		await expect(execution).rejects.toMatchObject({
			kind: ClientErrorKind.Cancelled,
		});
		expect(rootCancellation.token.isCancellationRequested).toBe(false);
	});

	it("rejects an explicit null input with the stable input error", async () => {
		const { handler } = createHandler({ inputResolver: () => null });

		await expect(handler.handle({ input: null })).rejects.toMatchObject({
			code: "test.callback.input_not_found",
		});
	});
});
