import { describe, expect, it } from "vitest";
import {
	AuthObservationProfileId,
	AuthObservationSurface,
	authObservationIncludesSurface,
	authObservationProfiles,
	listAuthObservationHierarchy,
} from "../authObservationHierarchy";

describe("auth observation hierarchy", () => {
	it("keeps both token-set host paths on the structured trace surface", () => {
		expect(
			authObservationProfiles[AuthObservationProfileId.TokenSetFrontendHost]
				.primarySurface,
		).toBe(AuthObservationSurface.StructuredTraceOrDiagnosis);
		expect(
			authObservationProfiles[AuthObservationProfileId.TokenSetBackendHost]
				.primarySurface,
		).toBe(AuthObservationSurface.StructuredTraceOrDiagnosis);
	});

	it("positions basic-auth and browser harness on distinct hierarchy levels", () => {
		const basicAuthHierarchy = listAuthObservationHierarchy(
			AuthObservationProfileId.BasicAuthBrowserBoundary,
		);
		const browserHarnessHierarchy = listAuthObservationHierarchy(
			AuthObservationProfileId.BrowserHarnessVerifiedEnvironment,
		);

		expect(basicAuthHierarchy[0]?.rank).toBe(1);
		expect(basicAuthHierarchy[0]?.surface).toBe(
			AuthObservationSurface.PublicResult,
		);
		expect(
			authObservationIncludesSurface(
				AuthObservationProfileId.BasicAuthBrowserBoundary,
				AuthObservationSurface.FocusedHarnessInteraction,
			),
		).toBe(true);

		expect(browserHarnessHierarchy[0]?.rank).toBe(1);
		expect(browserHarnessHierarchy[0]?.surface).toBe(
			AuthObservationSurface.PublicResult,
		);
		expect(
			authObservationProfiles[
				AuthObservationProfileId.BrowserHarnessVerifiedEnvironment
			].primarySurface,
		).toBe(AuthObservationSurface.FocusedHarnessInteraction);
	});
});
