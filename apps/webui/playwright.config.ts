import { defineConfig } from "@playwright/test";
import { getConfiguredProjects } from "./e2e/support/browser-harness.ts";
import { DetectionSource } from "./e2e/support/browser-harness-contract.ts";
import {
	oidcIssuerUrl,
	serverBaseUrl,
	webuiBaseUrl,
	webuiPort,
} from "./e2e/support/constants.ts";

const webuiDir = import.meta.dirname;
const configuredProjects = getConfiguredProjects({
	includeBlocked: process.env.PLAYWRIGHT_INCLUDE_BLOCKED_PROJECTS === "1",
});

if (configuredProjects.length === 0) {
	throw new Error(
		[
			"WebUI e2e tests require at least one available Playwright browser project, but none were detected.",
			"Run `just setup-playwright` to install Playwright-managed browsers, or set SECURITYDEPT_PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH / SECURITYDEPT_PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH / SECURITYDEPT_PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH to a valid browser executable.",
		].join(" "),
	);
}

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	workers: 1,
	timeout: 90_000,
	expect: {
		timeout: 15_000,
	},
	use: {
		baseURL: webuiBaseUrl,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
	projects: configuredProjects.map((project) => ({
		name: project.browserName,
		use: {
			browserName: project.browserName,
			launchOptions:
				project.detectionSource === DetectionSource.SystemExecutable &&
				project.executablePath
					? { executablePath: project.executablePath }
					: undefined,
		},
	})),
	webServer: [
		{
			command: "node ./e2e/support/start-oidc-provider.ts",
			cwd: webuiDir,
			name: "OIDC Provider",
			url: `${oidcIssuerUrl}/healthz`,
			reuseExistingServer: !process.env.CI,
			timeout: 60_000,
			stdout: "pipe",
			stderr: "pipe",
			gracefulShutdown: {
				signal: "SIGTERM",
				timeout: 5_000,
			},
		},
		{
			command: "node ./e2e/support/start-securitydept-server.ts",
			cwd: webuiDir,
			name: "SecurityDept Server",
			url: `${serverBaseUrl}/api/health?api_details=true`,
			reuseExistingServer: !process.env.CI,
			timeout: 120_000,
			stdout: "pipe",
			stderr: "pipe",
			gracefulShutdown: {
				signal: "SIGTERM",
				timeout: 5_000,
			},
		},
		{
			command: `pnpm exec vite dev --host localhost --port ${webuiPort} --strictPort`,
			cwd: webuiDir,
			env: {
				...process.env,
				VITE_BACKEND_URL: serverBaseUrl,
			},
			name: "WebUI",
			url: `${webuiBaseUrl}/login`,
			reuseExistingServer: !process.env.CI,
			timeout: 120_000,
			stdout: "pipe",
			stderr: "pipe",
			gracefulShutdown: {
				signal: "SIGTERM",
				timeout: 5_000,
			},
		},
	],
});
