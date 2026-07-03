// --- Error model ---
// Dual-layer: machine-facing runtime error + user-facing presentation / recovery hint.

import { type SpanNodeAttributes } from "../span/types";

export type ClientErrorSpanContext = readonly SpanNodeAttributes[];

/** Recovery actions the user might take. Aligned with server-side `UserRecovery`. */
export const UserRecovery = {
	None: "none",
	Retry: "retry",
	RestartFlow: "restart_flow",
	Reauthenticate: "reauthenticate",
	ContactSupport: "contact_support",
} as const;

export type UserRecovery = (typeof UserRecovery)[keyof typeof UserRecovery];

/** Safe user-facing presentation supplied by a server error response. */
export interface ServerErrorPresentation {
	code: string;
	message: string;
	recovery: UserRecovery;
}

export const ErrorPresentationTone = {
	Neutral: "neutral",
	Warning: "warning",
	Danger: "danger",
} as const;

export type ErrorPresentationTone =
	(typeof ErrorPresentationTone)[keyof typeof ErrorPresentationTone];

export interface ErrorRecoveryActionDescriptor {
	recovery: UserRecovery;
	label: string;
	href: string | null;
}

export interface ErrorPresentationDescriptor {
	code: string | null;
	title: string;
	description: string;
	recovery: UserRecovery;
	tone: ErrorPresentationTone;
	primaryAction: ErrorRecoveryActionDescriptor | null;
}

export interface ReadErrorPresentationDescriptorOptions {
	fallbackTitle?: string;
	fallbackDescription?: string;
	codePresentations?: Readonly<Record<string, ErrorCodePresentation>>;
	recoveryLinks?: Partial<Record<UserRecovery, string>>;
	recoveryLabels?: Partial<Record<UserRecovery, string>>;
	contextFormatter?: ClientErrorContextFormatter | null;
}

export type ClientErrorContextFormatter = (
	context: ClientErrorSpanContext,
) => string | undefined;

export interface ErrorCodePresentation {
	title: string;
	description: string;
	tone?: ErrorPresentationTone;
	recovery?: UserRecovery;
}

/** Machine-facing error kind discriminator. */
export const ClientErrorKind = {
	Authorization: "authorization",
	Transport: "transport",
	Server: "server",
	Protocol: "protocol",
	Storage: "storage",
	Configuration: "configuration",
	Unauthenticated: "unauthenticated",
	Unauthorized: "unauthorized",
	Cancelled: "cancelled",
	Timeout: "timeout",
	Internal: "internal",
} as const;

export type ClientErrorKind =
	(typeof ClientErrorKind)[keyof typeof ClientErrorKind];

/** Stable source vocabulary for common client error producers. */
export const ClientErrorSource = {
	Transport: "transport",
	Server: "server",
	Client: "client",
} as const;

export type ClientErrorSource =
	(typeof ClientErrorSource)[keyof typeof ClientErrorSource];
