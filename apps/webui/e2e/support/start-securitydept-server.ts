import { spawn } from "node:child_process";
import path from "node:path";
import {
	bindChildProcessLifecycle,
	renderTemplateToFile,
} from "@securitydept/e2e-utils";

import {
	oidcClientId,
	oidcIssuerUrl,
	repoRootDir,
	serverBaseUrl,
	tempDir,
	webuiBaseUrl,
} from "./constants.ts";

const templatePath = path.join(
	repoRootDir,
	"apps",
	"webui",
	"e2e",
	"fixtures",
	"securitydept.e2e.config.toml.j2",
);
const configPath = path.join(tempDir, "securitydept.frontend-oidc.e2e.toml");
const dataPath = path.join(tempDir, "securitydept.frontend-oidc.e2e.data.json");

async function prepareConfig(): Promise<string> {
	await renderTemplateToFile({
		templatePath,
		outputPath: configPath,
		context: {
			serverPort: Number(new URL(serverBaseUrl).port),
			webuiBaseUrl,
			oidcWellKnownUrl: `${oidcIssuerUrl}/.well-known/openid-configuration`,
			oidcClientId,
			dataPath: dataPath.replaceAll("\\", "/"),
		},
	});
	return configPath;
}

const renderedConfigPath = await prepareConfig();

const isolatedServerEnv = Object.fromEntries(
	Object.entries(process.env).filter(([key]) => !key.startsWith("OIDC__")),
);

const serverProcess = spawn(
	"mise",
	[
		"exec",
		"--",
		"cargo",
		"run",
		"--manifest-path",
		path.join(repoRootDir, "apps", "server", "Cargo.toml"),
		"--",
		"--config",
		renderedConfigPath,
		"serve",
	],
	{
		cwd: repoRootDir,
		env: {
			...isolatedServerEnv,
			RUST_LOG: process.env.RUST_LOG ?? "warn",
			SECURITYDEPT_CONFIG: renderedConfigPath,
		},
		stdio: "inherit",
	},
);

bindChildProcessLifecycle(serverProcess);
