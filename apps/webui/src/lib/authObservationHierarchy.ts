export const AuthObservationSurface = {
	PublicResult: "public_result",
	RedirectOrResponseInstruction: "redirect_or_response_instruction",
	StructuredTraceOrDiagnosis: "structured_trace_or_diagnosis",
	FocusedHarnessInteraction: "focused_harness_interaction",
	HumanReadableTextOrLog: "human_readable_text_or_log",
} as const;

export type AuthObservationSurface =
	(typeof AuthObservationSurface)[keyof typeof AuthObservationSurface];

export const authObservationSurfaceRank: Record<
	AuthObservationSurface,
	number
> = {
	[AuthObservationSurface.PublicResult]: 1,
	[AuthObservationSurface.RedirectOrResponseInstruction]: 2,
	[AuthObservationSurface.StructuredTraceOrDiagnosis]: 3,
	[AuthObservationSurface.FocusedHarnessInteraction]: 4,
	[AuthObservationSurface.HumanReadableTextOrLog]: 5,
};

export const authObservationSurfaceLabel: Record<
	AuthObservationSurface,
	string
> = {
	[AuthObservationSurface.PublicResult]: "public result / protocol result",
	[AuthObservationSurface.RedirectOrResponseInstruction]:
		"redirect / response instruction",
	[AuthObservationSurface.StructuredTraceOrDiagnosis]:
		"structured trace / diagnosis surface",
	[AuthObservationSurface.FocusedHarnessInteraction]:
		"focused fake / harness interaction",
	[AuthObservationSurface.HumanReadableTextOrLog]: "human-readable text / log",
};

export const AuthObservationProfileId = {
	TokenSetFrontendHost: "token_set_frontend_host",
	TokenSetBackendHost: "token_set_backend_host",
	BasicAuthBrowserBoundary: "basic_auth_browser_boundary",
	BrowserHarnessVerifiedEnvironment: "browser_harness_verified_environment",
} as const;

export type AuthObservationProfileId =
	(typeof AuthObservationProfileId)[keyof typeof AuthObservationProfileId];

export interface AuthObservationProfile {
	id: AuthObservationProfileId;
	title: string;
	summary: string;
	primarySurface: AuthObservationSurface;
	supportingSurfaces: readonly AuthObservationSurface[];
}

export const authObservationProfiles: Record<
	AuthObservationProfileId,
	AuthObservationProfile
> = {
	[AuthObservationProfileId.TokenSetFrontendHost]: {
		id: AuthObservationProfileId.TokenSetFrontendHost,
		title: "Token-set frontend host trace",
		summary:
			"Frontend-mode authority lives first on the shared structured trace timeline, then on callback and popup route outcomes, with page copy only as supporting guidance.",
		primarySurface: AuthObservationSurface.StructuredTraceOrDiagnosis,
		supportingSurfaces: [
			AuthObservationSurface.PublicResult,
			AuthObservationSurface.RedirectOrResponseInstruction,
			AuthObservationSurface.HumanReadableTextOrLog,
		],
	},
	[AuthObservationProfileId.TokenSetBackendHost]: {
		id: AuthObservationProfileId.TokenSetBackendHost,
		title: "Token-set backend host trace",
		summary:
			"Backend-mode authority also lives first on the structured trace timeline that combines SDK lifecycle and host-owned probe events.",
		primarySurface: AuthObservationSurface.StructuredTraceOrDiagnosis,
		supportingSurfaces: [
			AuthObservationSurface.PublicResult,
			AuthObservationSurface.RedirectOrResponseInstruction,
			AuthObservationSurface.HumanReadableTextOrLog,
		],
	},
	[AuthObservationProfileId.BasicAuthBrowserBoundary]: {
		id: AuthObservationProfileId.BasicAuthBrowserBoundary,
		title: "Basic-auth browser boundary",
		summary:
			"Basic-auth authority starts at browser-visible protocol results, then the explicit challenge or poison response instructions, with harness-only paths used to isolate browser-managed credential behavior.",
		primarySurface: AuthObservationSurface.PublicResult,
		supportingSurfaces: [
			AuthObservationSurface.RedirectOrResponseInstruction,
			AuthObservationSurface.FocusedHarnessInteraction,
			AuthObservationSurface.HumanReadableTextOrLog,
		],
	},
	[AuthObservationProfileId.BrowserHarnessVerifiedEnvironment]: {
		id: AuthObservationProfileId.BrowserHarnessVerifiedEnvironment,
		title: "Browser harness verified environment",
		summary:
			"Harness authority starts by constraining a focused verified browser/runtime interaction, then projects that result back into public baseline claims and human-readable status.",
		primarySurface: AuthObservationSurface.FocusedHarnessInteraction,
		supportingSurfaces: [
			AuthObservationSurface.PublicResult,
			AuthObservationSurface.HumanReadableTextOrLog,
		],
	},
};

export function listAuthObservationHierarchy(
	profileId: AuthObservationProfileId,
): Array<{ rank: number; label: string; surface: AuthObservationSurface }> {
	const profile = authObservationProfiles[profileId];
	const uniqueSurfaces = [
		profile.primarySurface,
		...profile.supportingSurfaces.filter(
			(surface) => surface !== profile.primarySurface,
		),
	];

	return uniqueSurfaces
		.toSorted(
			(left, right) =>
				authObservationSurfaceRank[left] - authObservationSurfaceRank[right],
		)
		.map((surface) => ({
			rank: authObservationSurfaceRank[surface],
			label: authObservationSurfaceLabel[surface],
			surface,
		}));
}

export function authObservationIncludesSurface(
	profileId: AuthObservationProfileId,
	surface: AuthObservationSurface,
): boolean {
	const profile = authObservationProfiles[profileId];
	return (
		profile.primarySurface === surface ||
		profile.supportingSurfaces.includes(surface)
	);
}
