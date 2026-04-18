import {
	type BrowserExecutionBaselinePolicy,
	ExecutionBaseline,
	ExecutionBaselineRole,
	HarnessBrowserName,
} from "./browser-harness-contract.ts";

export function buildExecutionBaselinePolicy(): BrowserExecutionBaselinePolicy[] {
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
			preferredExecutionBaseline: ExecutionBaseline.DistroboxHosted,
			hostNative: {
				executionBaseline: ExecutionBaseline.HostNative,
				role: ExecutionBaselineRole.HostTruth,
				summary:
					"WebKit host-native still records the real host bring-up truth, especially when unsupported Linux hosts block before auth-flow begins.",
			},
			distroboxHosted: {
				executionBaseline: ExecutionBaseline.DistroboxHosted,
				role: ExecutionBaselineRole.CanonicalRecoveryPath,
				summary:
					"WebKit uses distrobox-hosted Ubuntu as the canonical recovery path that can establish verified browser-owned evidence on unsupported Linux hosts.",
			},
			summary:
				"WebKit keeps host-native blocked evidence as host truth, while distrobox-hosted Ubuntu is the canonical path for verified browser-owned execution on unsupported Linux hosts.",
		},
	];
}
