// --- Error model ---
// Dual-layer: machine-facing runtime error + user-facing presentation / recovery hint.

/** Recovery actions the user might take. Aligned with server-side `UserRecovery`. */
export const UserRecovery = {
	None: "none",
	Retry: "retry",
	RestartFlow: "restart_flow",
	Reauthenticate: "reauthenticate",
	ContactSupport: "contact_support",
} as const;

export type UserRecovery = (typeof UserRecovery)[keyof typeof UserRecovery];

/** User-facing error presentation. `code` is the cross-platform stable contract. */
export interface ErrorPresentation {
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

export interface ErrorPresentationActionDescriptor {
	recovery: UserRecovery;
	label: string;
	href: string | null;
}

export interface ErrorPresentationDescriptor {
	code: string | null;
	kind: ClientErrorKind | null;
	source?: string;
	title: string;
	description: string;
	recovery: UserRecovery;
	retryable: boolean;
	tone: ErrorPresentationTone;
	primaryAction: ErrorPresentationActionDescriptor | null;
}

export interface ReadErrorPresentationDescriptorOptions {
	fallbackTitle?: string;
	fallbackDescription?: string;
	recoveryLinks?: Partial<Record<UserRecovery, string>>;
	recoveryLabels?: Partial<Record<UserRecovery, string>>;
}

/** Machine-facing error kind discriminator. */
export const ClientErrorKind = {
	Authorization: "authorization",
	Transport: "transport",
	Server: "server",
	Protocol: "protocol",
	Presentation: "presentation",
	Validation: "validation",
	Storage: "storage",
	Scheduler: "scheduler",
	Configuration: "configuration",
	Unauthenticated: "unauthenticated",
	Unauthorized: "unauthorized",
	RedirectRequired: "redirect_required",
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
	ClientRuntime: "client_runtime",
} as const;

export type ClientErrorSource =
	(typeof ClientErrorSource)[keyof typeof ClientErrorSource];
