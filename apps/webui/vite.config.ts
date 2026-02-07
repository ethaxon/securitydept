import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	const backendUrl = env.VITE_BACKEND_URL || "http://localhost:7021";

	return {
		plugins: [react(), tailwindcss()],
		resolve: {
			alias: {
				"@": resolve(__dirname, "./src"),
			},
		},
		server: {
			proxy: {
				"/auth": {
					target: backendUrl,
					// for local development server use forwarded header as callback url
					headers: {
						Forwarded: "for=127.0.0.1;proto=http;host=localhost:7022",
					},
				},
				"/api": {
					target: backendUrl,
					// for local development server use forwarded header as callback url
					headers: {
						Forwarded: "for=127.0.0.1;proto=http;host=localhost:7022",
					},
				},
			},
			port: 7022,
		},
		build: {
			outDir: "dist",
		},
	};
});
