import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import {
	BlockedReason,
	BrowserAvailability,
	DetectionSource,
	ExecutionBaseline,
	HarnessBrowserName,
	type HarnessBrowserName as HarnessBrowserNameType,
	type PlaywrightProjectCapability,
	UnavailableReason,
} from "./browser-harness-contract.ts";

const require = createRequire(import.meta.url);

const chromiumCandidatePaths = ["/sbin/chromium", "/usr/bin/chromium"];

const browserExecutableOverrideEnv = {
	[HarnessBrowserName.Chromium]:
		"SECURITYDEPT_PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
	[HarnessBrowserName.Firefox]:
		"SECURITYDEPT_PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH",
	[HarnessBrowserName.Webkit]: "SECURITYDEPT_PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH",
} as const satisfies Record<HarnessBrowserNameType, string>;

export interface WebkitRuntimeProbeResult {
	availability:
		| typeof BrowserAvailability.Available
		| typeof BrowserAvailability.Blocked;
	blockedReason?: typeof BlockedReason.HostDependenciesMissing;
	blockedDetails?: string;
}

export interface BrowserCapabilityDetectionAdapter {
	env?: NodeJS.ProcessEnv;
	fileExists?: (filePath: string) => boolean;
	resolveSystemChromiumExecutablePath?: () => string | undefined;
	resolveManagedExecutablePath?: (
		browserName: HarnessBrowserNameType,
	) => string | undefined;
	probeWebkitRuntime?: (executablePath: string) => WebkitRuntimeProbeResult;
}

export function detectExecutionBaseline(
	env: NodeJS.ProcessEnv = process.env,
): ExecutionBaseline {
	return env.DISTROBOX_ENTER_PATH || env.CONTAINER_ID
		? ExecutionBaseline.DistroboxHosted
		: ExecutionBaseline.HostNative;
}

export function extractMissingSharedLibraryDetails(
	stderr: string,
): string | undefined {
	if (!stderr.includes("error while loading shared libraries:")) {
		return undefined;
	}

	const matches = stderr.match(/lib[^\s:]+\.so(?:\.\d+)*/g) ?? [];
	const libraryNames = [...new Set(matches)];
	if (libraryNames.length > 0) {
		return `Missing host libraries observed from runtime probe: ${libraryNames.join(", ")}.`;
	}

	const firstLine = stderr.trim().split("\n")[0];
	return firstLine.length > 0
		? `Missing host libraries observed from runtime probe: ${firstLine}`
		: "Missing host libraries observed from runtime probe.";
}

export function probeWebkitRuntime(
	executablePath: string,
): WebkitRuntimeProbeResult {
	const result = spawnSync(executablePath, ["--version"], {
		encoding: "utf8",
		timeout: 3_000,
	});
	const blockedDetails = extractMissingSharedLibraryDetails(
		result.stderr ?? "",
	);
	if (blockedDetails) {
		return {
			availability: BrowserAvailability.Blocked,
			blockedReason: BlockedReason.HostDependenciesMissing,
			blockedDetails,
		};
	}

	return { availability: BrowserAvailability.Available };
}

function resolveExecutableOverride(
	browserName: HarnessBrowserNameType,
	env: NodeJS.ProcessEnv,
	fileExists: (filePath: string) => boolean,
): string | undefined {
	const overridePath = env[browserExecutableOverrideEnv[browserName]];
	return overridePath && fileExists(overridePath) ? overridePath : undefined;
}

function defaultResolveSystemChromiumExecutablePath(
	fileExists: (filePath: string) => boolean,
): string | undefined {
	return chromiumCandidatePaths.find((candidate) => fileExists(candidate));
}

function defaultResolveManagedExecutablePath(
	browserName: HarnessBrowserNameType,
	fileExists: (filePath: string) => boolean,
): string | undefined {
	const playwrightBrowsers = loadPlaywrightBrowsers();
	if (!playwrightBrowsers) {
		return undefined;
	}

	const executablePath =
		browserName === HarnessBrowserName.Firefox
			? playwrightBrowsers.firefox.executablePath()
			: browserName === HarnessBrowserName.Webkit
				? playwrightBrowsers.webkit.executablePath()
				: playwrightBrowsers.chromium.executablePath();
	return fileExists(executablePath) ? executablePath : undefined;
}

function loadPlaywrightBrowsers():
	| {
			chromium: { executablePath(): string };
			firefox: { executablePath(): string };
			webkit: { executablePath(): string };
	  }
	| undefined {
	const loadModule = (specifier: string) => {
		try {
			return require(specifier);
		} catch {
			return undefined;
		}
	};

	const playwrightModule =
		loadModule("playwright") ?? loadModule("@playwright/test");
	if (
		!playwrightModule?.chromium ||
		!playwrightModule?.firefox ||
		!playwrightModule?.webkit
	) {
		return undefined;
	}

	return playwrightModule;
}

export function detectBrowserCapabilities(
	adapter: BrowserCapabilityDetectionAdapter = {},
): PlaywrightProjectCapability[] {
	const env = adapter.env ?? process.env;
	const fileExists = adapter.fileExists ?? existsSync;
	const executionBaseline = detectExecutionBaseline(env);
	const resolveManagedExecutablePath =
		adapter.resolveManagedExecutablePath ??
		((browserName: HarnessBrowserNameType) =>
			resolveExecutableOverride(browserName, env, fileExists) ??
			defaultResolveManagedExecutablePath(browserName, fileExists));
	const resolveSystemChromiumExecutablePath =
		adapter.resolveSystemChromiumExecutablePath ??
		(() =>
			resolveExecutableOverride(HarnessBrowserName.Chromium, env, fileExists) ??
			defaultResolveSystemChromiumExecutablePath(fileExists));
	const chromiumPath = resolveSystemChromiumExecutablePath();
	const firefoxPath = resolveManagedExecutablePath(HarnessBrowserName.Firefox);
	const webkitPath = resolveManagedExecutablePath(HarnessBrowserName.Webkit);
	const webkitRuntimeProbe = webkitPath
		? (adapter.probeWebkitRuntime ?? probeWebkitRuntime)(webkitPath)
		: undefined;

	return [
		chromiumPath
			? {
					browserName: HarnessBrowserName.Chromium,
					availability: BrowserAvailability.Available,
					executionBaseline,
					executablePath: chromiumPath,
					detectionSource: DetectionSource.SystemExecutable,
				}
			: {
					browserName: HarnessBrowserName.Chromium,
					availability: BrowserAvailability.Unavailable,
					executionBaseline,
					unavailableReason: UnavailableReason.ExecutableNotDetected,
				},
		firefoxPath
			? {
					browserName: HarnessBrowserName.Firefox,
					availability: BrowserAvailability.Available,
					executionBaseline,
					executablePath: firefoxPath,
					detectionSource: DetectionSource.PlaywrightManaged,
				}
			: {
					browserName: HarnessBrowserName.Firefox,
					availability: BrowserAvailability.Unavailable,
					executionBaseline,
					unavailableReason: UnavailableReason.ExecutableNotDetected,
				},
		webkitPath
			? webkitRuntimeProbe?.availability === BrowserAvailability.Blocked
				? {
						browserName: HarnessBrowserName.Webkit,
						availability: BrowserAvailability.Blocked,
						executionBaseline,
						executablePath: webkitPath,
						detectionSource: DetectionSource.PlaywrightManaged,
						blockedReason: webkitRuntimeProbe.blockedReason,
						blockedDetails: webkitRuntimeProbe.blockedDetails,
					}
				: {
						browserName: HarnessBrowserName.Webkit,
						availability: BrowserAvailability.Available,
						executionBaseline,
						executablePath: webkitPath,
						detectionSource: DetectionSource.PlaywrightManaged,
					}
			: {
					browserName: HarnessBrowserName.Webkit,
					availability: BrowserAvailability.Unavailable,
					executionBaseline,
					unavailableReason: UnavailableReason.ProjectNotConfigured,
				},
	];
}
