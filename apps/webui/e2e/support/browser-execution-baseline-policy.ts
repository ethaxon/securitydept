import {
	type BrowserExecutionBaselinePolicy,
	ExecutionBaseline,
	ExecutionBaselineRole,
	HarnessBrowserName,
} from "./browser-harness-contract.ts";
import {
	type HostPlatformAdapter,
	shouldPreferDistroboxHostedWebkit,
} from "./host-platform.ts";

type BuildExecutionBaselinePolicyOptions = {
	hostPlatform?: HostPlatformAdapter;
};

export function buildExecutionBaselinePolicy(
	options: BuildExecutionBaselinePolicyOptions = {},
): BrowserExecutionBaselinePolicy[] {
	const preferDistroboxHostedWebkit = shouldPreferDistroboxHostedWebkit(
		options.hostPlatform,
	);

	return [
		{
			browserName: HarnessBrowserName.Chromium,
			preferredExecutionBaseline: ExecutionBaseline.HostNative,
			hostNative: {
				executionBaseline: ExecutionBaseline.HostNative,
				role: ExecutionBaselineRole.PrimaryAuthority,
				summary:
					"Chromium keeps host-native browser-owned auth behavior as the primary authority while that host baseline is verified.",
			},
			distroboxHosted: {
				executionBaseline: ExecutionBaseline.DistroboxHosted,
				role: ExecutionBaselineRole.NotAdopted,
				summary:
					"Chromium is not currently moved into distrobox because that would flatten host-native browser evidence without solving an existing bring-up gap.",
			},
			summary:
				"Chromium currently keeps host-native as the authoritative execution baseline; distrobox-hosted execution is not the formal policy target.",
		},
		{
			browserName: HarnessBrowserName.Firefox,
			preferredExecutionBaseline: ExecutionBaseline.HostNative,
			hostNative: {
				executionBaseline: ExecutionBaseline.HostNative,
				role: ExecutionBaselineRole.PrimaryAuthority,
				summary:
					"Firefox keeps host-native browser-owned auth behavior as the primary authority while that host baseline is verified.",
			},
			distroboxHosted: {
				executionBaseline: ExecutionBaseline.DistroboxHosted,
				role: ExecutionBaselineRole.NotAdopted,
				summary:
					"Firefox is not currently moved into distrobox because the host-native verified baseline remains closer to real local browser behavior.",
			},
			summary:
				"Firefox currently keeps host-native as the authoritative execution baseline; distrobox-hosted execution is not the formal policy target.",
		},
		{
			browserName: HarnessBrowserName.Webkit,
			preferredExecutionBaseline: preferDistroboxHostedWebkit
				? ExecutionBaseline.DistroboxHosted
				: ExecutionBaseline.HostNative,
			hostNative: {
				executionBaseline: ExecutionBaseline.HostNative,
				role: preferDistroboxHostedWebkit
					? ExecutionBaselineRole.HostTruth
					: ExecutionBaselineRole.PrimaryAuthority,
				summary: preferDistroboxHostedWebkit
					? "WebKit host-native still records the real host bring-up truth, especially when unsupported Linux hosts block before auth-flow begins."
					: "WebKit keeps host-native browser-owned auth behavior as the primary authority when the host runtime itself is a verified baseline.",
			},
			distroboxHosted: {
				executionBaseline: ExecutionBaseline.DistroboxHosted,
				role: preferDistroboxHostedWebkit
					? ExecutionBaselineRole.CanonicalRecoveryPath
					: ExecutionBaselineRole.NotAdopted,
				summary: preferDistroboxHostedWebkit
					? "WebKit uses distrobox-hosted Ubuntu as the canonical recovery path that can establish verified browser-owned evidence on unsupported Linux hosts."
					: "WebKit does not need a distrobox-hosted baseline when the host runtime itself is already the verified environment.",
			},
			summary: preferDistroboxHostedWebkit
				? "WebKit keeps host-native blocked evidence as host truth, while distrobox-hosted Ubuntu is the canonical path for verified browser-owned execution on unsupported Linux hosts."
				: "WebKit keeps host-native as the authoritative execution baseline when the host runtime itself is verified.",
		},
	];
}
