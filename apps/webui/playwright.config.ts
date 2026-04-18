import { defineConfig } from "@playwright/test";
import { getConfiguredProjects } from "./e2e/support/browser-harness.ts";
import {
	serverBaseUrl,
	webuiBaseUrl,
	webuiPort,
} from "./e2e/support/constants.ts";

const webuiDir = import.meta.dirname;
const configuredProjects = getConfiguredProjects({
	includeBlocked: process.env.PLAYWRIGHT_INCLUDE_BLOCKED_PROJECTS === "1",
});

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
			launchOptions: project.executablePath
				? { executablePath: project.executablePath }
				: undefined,
		},
	})),
	webServer: [
		{
			command: "node ./e2e/support/start-oidc-provider.ts",
			cwd: webuiDir,
			name: "OIDC Provider",
			wait: {
				stdout: /SecurityDept E2E OIDC provider listening at /,
			},
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
