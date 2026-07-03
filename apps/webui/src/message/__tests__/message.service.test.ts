import {
	ClientError,
	ClientErrorKind,
	createFoundationEnvironment,
	createRootSpan,
	isClientErrorEvent,
	SpanSharedAttributeName,
	UserRecovery,
} from "@securitydept/client";
import { SessionContextClient } from "@securitydept/session-context-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
	error: vi.fn(),
	info: vi.fn(),
	warning: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));

import { MessageService } from "../message.service";

describe("MessageService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("presents client errors through the matching toast tone", () => {
		const service = new MessageService();

		service.showError(
			new ClientError({
				kind: ClientErrorKind.Transport,
				code: "test.transport_failed",
				message: "request failed",
				recovery: UserRecovery.Retry,
			}),
		);

		expect(toast.warning).toHaveBeenCalledWith("Network request failed", {
			description: "The client could not reach the service.",
		});
		expect(toast.error).not.toHaveBeenCalled();
	});

	it.each([
		["SessionContextClient", "session_context.refresh"],
		["BasicAuthContextClient", "basic_auth.refresh"],
		["FrontendOidcModeClient", "frontend_oidc.refresh"],
	])("presents %s failures with their span-owned operation source", (clientName, operationName) => {
		const service = new MessageService();
		const clientSpan = createRootSpan({
			attributes: {
				[SpanSharedAttributeName.ClientName]: clientName,
			},
		});
		const operationSpan = clientSpan.fork({
			attributes: {
				[SpanSharedAttributeName.OperationName]: operationName,
			},
		});

		service.showError(
			new ClientError({
				kind: ClientErrorKind.Server,
				message: "request failed",
				span: operationSpan,
			}),
		);

		expect(toast.warning).toHaveBeenCalledWith(
			`${clientName} · ${operationName}: Server request failed`,
			{
				description: "The service could not complete the request.",
			},
		);
	});

	it("presents an intercepted Session user-info failure without event-specific mapping", async () => {
		const service = new MessageService();
		const client = SessionContextClient.fromEnvironmentConfig({
			config: { baseUrl: "https://api.example.com" },
			environment: createFoundationEnvironment({
				transport: {
					async execute() {
						return { status: 500, headers: {}, body: null };
					},
				},
			}),
		});
		client.events.subscribe({
			next(event) {
				if (isClientErrorEvent(event)) {
					service.showError(event.error);
				}
			},
		});

		await expect(client.refresh()).rejects.toBeInstanceOf(ClientError);

		expect(toast.warning).toHaveBeenCalledWith(
			"SessionContextClient · session_context.refresh: Server request failed",
			{
				description: "The service could not complete the request.",
			},
		);
	});
});
