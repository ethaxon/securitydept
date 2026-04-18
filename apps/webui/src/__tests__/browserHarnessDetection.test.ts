import { describe, expect, it } from "vitest";
import {
	detectBrowserCapabilities,
	extractMissingSharedLibraryDetails,
} from "../../e2e/support/browser-capability-detection.ts";
import { buildExecutionBaselinePolicy } from "../../e2e/support/browser-execution-baseline-policy.ts";
import {
	BlockedReason,
	BrowserAvailability,
	ExecutionBaseline,
	ExecutionBaselineRole,
	HarnessBrowserName,
} from "../../e2e/support/browser-harness-contract.ts";

describe("browser harness capability detection", () => {
	it("uses adapter/runtime inputs rather than assuming Playwright cache layout", () => {
		const capabilities = detectBrowserCapabilities({
			env: { CONTAINER_ID: "playwright-env" },
			resolveSystemChromiumExecutablePath: () => "/custom/system/chromium",
			resolveManagedExecutablePath: (browserName) =>
				browserName === HarnessBrowserName.Firefox
					? "/custom/runtime/firefox-bundle/browser"
					: browserName === HarnessBrowserName.Webkit
						? "/custom/runtime/webkit-entry"
						: undefined,
			probeWebkitRuntime: () => ({
				availability: BrowserAvailability.Available,
			}),
		});

		expect(capabilities).toEqual([
			{
				browserName: HarnessBrowserName.Chromium,
				availability: BrowserAvailability.Available,
				executionBaseline: ExecutionBaseline.DistroboxHosted,
				executablePath: "/custom/system/chromium",
				detectionSource: "system-executable",
			},
			{
				browserName: HarnessBrowserName.Firefox,
				availability: BrowserAvailability.Available,
				executionBaseline: ExecutionBaseline.DistroboxHosted,
				executablePath: "/custom/runtime/firefox-bundle/browser",
				detectionSource: "playwright-managed",
			},
			{
				browserName: HarnessBrowserName.Webkit,
				availability: BrowserAvailability.Available,
				executionBaseline: ExecutionBaseline.DistroboxHosted,
				executablePath: "/custom/runtime/webkit-entry",
				detectionSource: "playwright-managed",
			},
		]);
	});

	it("derives missing host library details from runtime diagnostics", () => {
		const blockedDetails = extractMissingSharedLibraryDetails(
			"MiniBrowser: error while loading shared libraries: libicudata.so.74: cannot open shared object file: No such file or directory\n",
		);

		expect(blockedDetails).toBe(
			"Missing host libraries observed from runtime probe: libicudata.so.74.",
		);

		const capabilities = detectBrowserCapabilities({
			resolveManagedExecutablePath: (browserName) =>
				browserName === HarnessBrowserName.Webkit
					? "/custom/runtime/webkit-entry"
					: undefined,
			probeWebkitRuntime: () => ({
				availability: BrowserAvailability.Blocked,
				blockedReason: BlockedReason.HostDependenciesMissing,
				blockedDetails,
			}),
		});

		expect(capabilities[2]).toMatchObject({
			browserName: HarnessBrowserName.Webkit,
			availability: BrowserAvailability.Blocked,
			blockedReason: BlockedReason.HostDependenciesMissing,
			blockedDetails:
				"Missing host libraries observed from runtime probe: libicudata.so.74.",
		});
	});

	it("keeps host-native authority separate from distrobox recovery policy", () => {
		const policy = buildExecutionBaselinePolicy();
		const firefoxPolicy = policy.find(
			(entry) => entry.browserName === HarnessBrowserName.Firefox,
		);
		const webkitPolicy = policy.find(
			(entry) => entry.browserName === HarnessBrowserName.Webkit,
		);

		expect(firefoxPolicy).toMatchObject({
			preferredExecutionBaseline: ExecutionBaseline.HostNative,
			hostNative: { role: ExecutionBaselineRole.PrimaryAuthority },
			distroboxHosted: { role: ExecutionBaselineRole.NotAdopted },
		});
		expect(webkitPolicy).toMatchObject({
			preferredExecutionBaseline: ExecutionBaseline.DistroboxHosted,
			hostNative: { role: ExecutionBaselineRole.HostTruth },
			distroboxHosted: {
				role: ExecutionBaselineRole.CanonicalRecoveryPath,
			},
		});
	});
});
