import type { IncomingMessage } from "node:http";
import path from "node:path";

import { renderTemplateFile } from "@securitydept/e2e-utils";
import Provider from "oidc-provider";

import {
	frontendCallbackUrl,
	frontendPopupCallbackUrl,
	oidcClientId,
	oidcIssuerUrl,
	oidcProviderPort,
	oidcTestAccount,
	repoRootDir,
	webuiBaseUrl,
} from "./constants.ts";

interface HarnessInteractionDetails {
	prompt: {
		name: string;
		details: {
			missingOIDCScope?: string[];
			missingOIDCClaims?: string[];
			missingResourceScopes?: Record<string, string[]>;
		};
	};
	params: {
		client_id?: string;
	};
	session?: {
		accountId: string;
	};
	grantId?: string;
}

interface TemplateDetail {
	label: string;
	value: string;
}

const fixturesDir = path.join(repoRootDir, "apps", "webui", "e2e", "fixtures");

const pkceConfig: { required: () => boolean; methods: string[] } = {
	required() {
		return true;
	},
	methods: ["S256"],
};

const providerConfiguration: Exclude<
	ConstructorParameters<typeof Provider>[1],
	undefined
> & {
	refreshTokenRotation: string;
} = {
	clients: [
		{
			application_type: "web",
			client_id: oidcClientId,
			grant_types: ["authorization_code", "refresh_token"],
			redirect_uris: [frontendCallbackUrl, frontendPopupCallbackUrl],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
		},
	],
	claims: {
		openid: ["sub"],
		profile: ["name", "preferred_username"],
		email: ["email", "email_verified"],
	},
	cookies: {
		keys: [
			"securitydept-e2e-cookie-secret-1",
			"securitydept-e2e-cookie-secret-2",
		],
	},
	features: {
		devInteractions: { enabled: false },
		introspection: { enabled: true },
		revocation: { enabled: true },
		userinfo: { enabled: true },
	},
	findAccount(_ctx, accountId) {
		if (accountId !== oidcTestAccount.accountId) {
			return undefined;
		}

		return {
			accountId,
			async claims() {
				return {
					sub: accountId,
					name: oidcTestAccount.displayName,
					preferred_username: oidcTestAccount.username,
					email: oidcTestAccount.email,
					email_verified: true,
				};
			},
		};
	},
	clientBasedCORS(_ctx, origin, client) {
		return origin === webuiBaseUrl && client?.clientId === oidcClientId;
	},
	interactions: {
		url(_ctx, interaction) {
			return `/interaction/${interaction.uid}`;
		},
	},
	pkce: pkceConfig,
	refreshTokenRotation: "rotateAndConsume",
};

function renderOidcTemplate(
	templateName: string,
	context: Record<string, unknown>,
): string {
	return renderTemplateFile(path.join(fixturesDir, templateName), context);
}

async function readFormBody(req: IncomingMessage): Promise<URLSearchParams> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of req) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function renderLoginPage(
	uid: string,
	loginHint: string,
	errorMessage: string | null = null,
): string {
	return renderOidcTemplate("oidc-login.html.j2", {
		uid,
		loginHint,
		errorMessage,
		usernameHint: oidcTestAccount.username,
		passwordHint: oidcTestAccount.password,
	});
}

function renderConsentPage(uid: string, clientId: string): string {
	return renderOidcTemplate("oidc-consent.html.j2", {
		uid,
		clientId,
	});
}

function renderMessagePage(options: {
	pageTitle: string;
	heading: string;
	body: string;
	details?: TemplateDetail[];
}): string {
	return renderOidcTemplate("oidc-message.html.j2", options);
}

const provider = new Provider(oidcIssuerUrl, providerConfiguration);

provider.proxy = true;
provider.use(async (ctx, next) => {
	if (!ctx.path.startsWith("/interaction/")) {
		await next();
		return;
	}

	const details = (await provider.interactionDetails(
		ctx.req,
		ctx.res,
	)) as HarnessInteractionDetails;
	const [, uid, action] =
		ctx.path.match(/^\/interaction\/([^/]+)(?:\/([^/]+))?$/) ?? [];
	if (!uid) {
		ctx.status = 404;
		return;
	}

	if (ctx.method === "GET") {
		ctx.type = "html";
		if (details.prompt.name === "login") {
			ctx.body = renderLoginPage(uid, oidcTestAccount.username);
			return;
		}
		if (details.prompt.name === "consent") {
			ctx.body = renderConsentPage(
				uid,
				details.params.client_id ?? oidcClientId,
			);
			return;
		}
		ctx.status = 501;
		ctx.body = renderMessagePage({
			pageTitle: "Unsupported prompt",
			heading: "Unsupported prompt",
			body: "The requested OIDC interaction prompt is not implemented by this harness.",
			details: [{ label: "Prompt", value: details.prompt.name }],
		});
		return;
	}

	if (ctx.method !== "POST") {
		ctx.status = 405;
		return;
	}

	const form = await readFormBody(ctx.req);
	if (details.prompt.name === "login" && action === "login") {
		const login = form.get("login")?.toString().trim() ?? "";
		const password = form.get("password")?.toString() ?? "";
		if (
			(login !== oidcTestAccount.username && login !== oidcTestAccount.email) ||
			password !== oidcTestAccount.password
		) {
			ctx.status = 401;
			ctx.type = "html";
			ctx.body = renderLoginPage(uid, login, "Unknown test credentials.");
			return;
		}

		await provider.interactionFinished(
			ctx.req,
			ctx.res,
			{ login: { accountId: oidcTestAccount.accountId } },
			{ mergeWithLastSubmission: false },
		);
		return;
	}

	if (details.prompt.name === "consent" && action === "confirm") {
		const existingGrant = details.grantId
			? await provider.Grant.find(details.grantId)
			: null;
		if (!details.session) {
			ctx.status = 400;
			ctx.type = "html";
			ctx.body = renderMessagePage({
				pageTitle: "Missing interaction session",
				heading: "Missing interaction session",
				body: "The OIDC provider did not attach a login session to this consent interaction.",
			});
			return;
		}
		const grant =
			existingGrant ??
			new provider.Grant({
				accountId: details.session.accountId,
				clientId: details.params.client_id,
			});

		if (details.prompt.details.missingOIDCScope?.length) {
			grant.addOIDCScope(details.prompt.details.missingOIDCScope.join(" "));
		}
		if (details.prompt.details.missingOIDCClaims?.length) {
			grant.addOIDCClaims(details.prompt.details.missingOIDCClaims);
		}
		if (details.prompt.details.missingResourceScopes) {
			for (const [indicator, scopes] of Object.entries(
				details.prompt.details.missingResourceScopes,
			)) {
				grant.addResourceScope(indicator, scopes.join(" "));
			}
		}

		await provider.interactionFinished(
			ctx.req,
			ctx.res,
			{ consent: { grantId: await grant.save() } },
			{ mergeWithLastSubmission: true },
		);
		return;
	}

	ctx.status = 400;
	ctx.type = "html";
	ctx.body = renderMessagePage({
		pageTitle: "Unexpected interaction action",
		heading: "Unexpected interaction action",
		body: "The harness received an interaction action it does not know how to process.",
		details: [
			{ label: "Action", value: action ?? "(missing)" },
			{ label: "Prompt", value: details.prompt.name },
		],
	});
});

provider.listen(oidcProviderPort, "127.0.0.1", () => {
	console.log(`SecurityDept E2E OIDC provider listening at ${oidcIssuerUrl}`);
});
