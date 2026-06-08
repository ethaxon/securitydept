import { describe, expect, it } from "vitest";
import { detectBrowserCapabilities } from "../../e2e/support/browser-capability-detection.ts";
import { buildExecutionBaselinePolicy } from "../../e2e/support/browser-execution-baseline-policy.ts";
import {
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

	it("treats detected managed webkit as available without runtime probing", () => {
		const capabilities = detectBrowserCapabilities({
			resolveManagedExecutablePath: (browserName) =>
				browserName === HarnessBrowserName.Webkit
					? "/custom/runtime/webkit-entry"
					: undefined,
		});

		expect(capabilities[2]).toMatchObject({
			browserName: HarnessBrowserName.Webkit,
			availability: BrowserAvailability.Available,
			executablePath: "/custom/runtime/webkit-entry",
		});
	});

	it("keeps host-native authority separate from distrobox recovery policy", () => {
		const ubuntuPolicy = buildExecutionBaselinePolicy({
			hostPlatform: {
				platform: "linux",
				readOsRelease: () => "ID=ubuntu\nID_LIKE=debian\n",
			},
		});
		const firefoxPolicy = ubuntuPolicy.find(
			(entry) => entry.browserName === HarnessBrowserName.Firefox,
		);
		const ubuntuWebkitPolicy = ubuntuPolicy.find(
			(entry) => entry.browserName === HarnessBrowserName.Webkit,
		);
		const unsupportedLinuxPolicy = buildExecutionBaselinePolicy({
			hostPlatform: {
				platform: "linux",
				readOsRelease: () => "ID=arch\nID_LIKE=archlinux\n",
			},
		});
		const unsupportedLinuxWebkitPolicy = unsupportedLinuxPolicy.find(
			(entry) => entry.browserName === HarnessBrowserName.Webkit,
		);

		expect(firefoxPolicy).toMatchObject({
			preferredExecutionBaseline: ExecutionBaseline.HostNative,
			hostNative: { role: ExecutionBaselineRole.PrimaryAuthority },
			distroboxHosted: { role: ExecutionBaselineRole.NotAdopted },
		});
		expect(ubuntuWebkitPolicy).toMatchObject({
			preferredExecutionBaseline: ExecutionBaseline.HostNative,
			hostNative: { role: ExecutionBaselineRole.PrimaryAuthority },
			distroboxHosted: { role: ExecutionBaselineRole.NotAdopted },
		});
		expect(unsupportedLinuxWebkitPolicy).toMatchObject({
			preferredExecutionBaseline: ExecutionBaseline.DistroboxHosted,
			hostNative: { role: ExecutionBaselineRole.HostTruth },
			distroboxHosted: {
				role: ExecutionBaselineRole.CanonicalRecoveryPath,
			},
		});
	});
});
