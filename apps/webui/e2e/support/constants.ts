import path from "node:path";
import { fileURLToPath } from "node:url";

const supportDir = path.dirname(fileURLToPath(import.meta.url));

export const webuiDir = path.resolve(supportDir, "..", "..");
export const repoRootDir = path.resolve(webuiDir, "..", "..");
export const tempDir = path.join(repoRootDir, "temp", "e2e");

export const oidcProviderPort = 4710;
export const serverPort = 4721;
export const webuiPort = 4722;

export const oidcIssuerUrl = `http://localhost:${oidcProviderPort}`;
export const serverBaseUrl = `http://localhost:${serverPort}`;
export const webuiBaseUrl = `http://localhost:${webuiPort}`;

export const frontendPlaygroundPath = "/playground/token-set/frontend-mode";
export const frontendCallbackPath = "/auth/token-set/frontend-mode/callback";
export const frontendCallbackUrl = `${webuiBaseUrl}${frontendCallbackPath}`;
export const frontendPopupCallbackPath =
	"/auth/token-set/frontend-mode/popup-callback";
export const frontendPopupCallbackUrl = `${webuiBaseUrl}${frontendPopupCallbackPath}`;

export const basicAuthPlaygroundPath = "/playground/basic-auth";
export const basicAuthLoginPath = "/basic/login";
export const basicAuthLogoutPath = "/basic/logout";

export const oidcClientId = "securitydept-webui-e2e";
export const oidcTestAccount = Object.freeze({
	accountId: "e2e-user",
	username: "e2e-user",
	password: "e2e-password",
	email: "e2e-user@example.com",
	displayName: "SecurityDept E2E User",
});
