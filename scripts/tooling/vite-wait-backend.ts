import { type Plugin } from "vite";
import { waitForHttpOk } from "./wait-for-http.ts";

const DefaultBackendUrl = "http://localhost:7021";
const DefaultHealthPath = "/api/health";
const DefaultTimeoutMs = 120_000;
const DefaultIntervalMs = 500;

export interface WaitBackendVitePluginOptions {
	backendUrl?: string;
	enabled?: boolean;
	timeoutMs?: number;
	intervalMs?: number;
}

function parsePositiveInt(value: string | undefined): number | undefined {
	if (!value) {
		return undefined;
	}

	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return undefined;
	}

	return parsed;
}

function isWaitEnabled(value: string | undefined): boolean {
	return value === "1" || value?.toLowerCase() === "true";
}

function resolveHealthUrl(backendUrl: string): string {
	return new URL(DefaultHealthPath, backendUrl).toString();
}

export function createWaitBackendVitePlugin(
	options: WaitBackendVitePluginOptions = {},
): Plugin {
	return {
		name: "securitydept-wait-backend",
		apply: "serve",
		enforce: "pre",
		async configureServer(server) {
			const env = server.config.env;
			const enabled =
				options.enabled ?? isWaitEnabled(env.VITE_WAIT_FOR_BACKEND);
			if (!enabled) {
				return;
			}

			const backendUrl =
				options.backendUrl ?? env.VITE_BACKEND_URL ?? DefaultBackendUrl;
			const healthUrl = resolveHealthUrl(backendUrl);
			const timeoutMs =
				options.timeoutMs ??
				parsePositiveInt(env.VITE_BACKEND_WAIT_TIMEOUT_MS) ??
				DefaultTimeoutMs;
			const intervalMs =
				options.intervalMs ??
				parsePositiveInt(env.VITE_BACKEND_WAIT_INTERVAL_MS) ??
				DefaultIntervalMs;

			const abortController = new AbortController();
			const handleAbort = () => {
				abortController.abort();
			};

			process.on("SIGINT", handleAbort);
			process.on("SIGTERM", handleAbort);

			server.config.logger.info(
				`waiting for backend health at ${healthUrl} ...`,
			);

			try {
				await waitForHttpOk({
					url: healthUrl,
					timeoutMs,
					intervalMs,
					signal: abortController.signal,
				});
				server.config.logger.info("backend is ready");
			} finally {
				process.off("SIGINT", handleAbort);
				process.off("SIGTERM", handleAbort);
			}
		},
	};
}
