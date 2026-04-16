import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";
import {
	serverBaseUrl,
	webuiBaseUrl,
	webuiPort,
} from "./e2e/support/constants.ts";

const webuiDir = import.meta.dirname;
const chromiumExecutablePath = ["/sbin/chromium", "/usr/bin/chromium"].find(
	(candidate) => existsSync(candidate),
);

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
		launchOptions: chromiumExecutablePath
			? { executablePath: chromiumExecutablePath }
			: undefined,
	},
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
