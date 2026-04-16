import { expect, test } from "@playwright/test";
import { FrontendOidcModeCallbackErrorCode } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { frontendPlaygroundPath } from "./support/constants.ts";
import {
	createFrontendModeCallbackUrl,
	seedFrontendOidcPendingState,
} from "./support/frontend-oidc-fixtures.ts";

async function completeFrontendModeLogin(
	page: import("@playwright/test").Page,
) {
	await page.goto(frontendPlaygroundPath);
	await page.getByRole("button", { name: "Start frontend-mode login" }).click();

	await expect(page.locator("#oidc-login")).toBeVisible();
	await page.locator("#oidc-login").fill("e2e-user");
	await page.locator("#oidc-password").fill("e2e-password");
	await page.locator("#oidc-submit").click();

	await expect(page.locator("#oidc-approve")).toBeVisible();
	const callbackArrival = page.waitForURL(
		/\/auth\/token-set\/frontend-mode\/callback\?/,
	);
	await page.locator("#oidc-approve").click();
	await callbackArrival;
	const callbackUrl = page.url();

	await page.waitForURL(`**${frontendPlaygroundPath}`);
	await expect(
		page.getByRole("button", { name: "Refresh tokens" }),
	).toBeEnabled();

	return callbackUrl;
}

test.describe("frontend-mode browser callback", () => {
	test("restores the playground route after a real browser-owned callback", async ({
		page,
	}) => {
		await completeFrontendModeLogin(page);

		await expect(page).toHaveURL(frontendPlaygroundPath);
		await expect(
			page.getByRole("heading", {
				name: "Browser-owned callback reference path",
			}),
		).toBeVisible();
		await expect(
			page.getByText("Default redirect: frontend-mode playground"),
		).toBeVisible();
	});

	test("surfaces duplicate callback replay after the first callback is consumed", async ({
		page,
	}) => {
		const callbackUrl = await completeFrontendModeLogin(page);

		await page.goto(callbackUrl);

		await expect(page).toHaveURL(
			/\/auth\/token-set\/frontend-mode\/callback\?/,
		);
		await expect(page.getByText("Callback already consumed")).toBeVisible();
		await expect(
			page.getByText(FrontendOidcModeCallbackErrorCode.DuplicateState),
		).toBeVisible();
	});

	test("surfaces unknown callback state with a restart path", async ({
		page,
	}) => {
		await page.goto(createFrontendModeCallbackUrl("missing-state"));

		await expect(page).toHaveURL(
			/\/auth\/token-set\/frontend-mode\/callback\?/,
		);
		await expect(page.getByText("Unknown callback state")).toBeVisible();
		await expect(
			page.getByText(FrontendOidcModeCallbackErrorCode.UnknownState),
		).toBeVisible();
		await expect(
			page.getByRole("link", {
				name: "Return to frontend-mode playground",
			}),
		).toBeVisible();
	});

	test("surfaces stale pending callback state with a restart path", async ({
		page,
	}) => {
		const { callbackUrl } = await seedFrontendOidcPendingState(page, {
			state: "stale-state",
			createdAt: Date.now() - 11 * 60 * 1000,
		});

		await page.goto(callbackUrl);

		await expect(page).toHaveURL(
			/\/auth\/token-set\/frontend-mode\/callback\?/,
		);
		await expect(page.getByText("Callback state expired")).toBeVisible();
		await expect(
			page.getByText(FrontendOidcModeCallbackErrorCode.PendingStale),
		).toBeVisible();
		await expect(page.getByText("restart_flow")).toBeVisible();
	});

	test("surfaces client-mismatch callback state with a restart path", async ({
		page,
	}) => {
		const { callbackUrl } = await seedFrontendOidcPendingState(page, {
			state: "mismatch-state",
			clientId: "other-frontend-client",
		});

		await page.goto(callbackUrl);

		await expect(page).toHaveURL(
			/\/auth\/token-set\/frontend-mode\/callback\?/,
		);
		await expect(
			page.getByText("Callback belongs to another frontend-mode client"),
		).toBeVisible();
		await expect(
			page.getByText(FrontendOidcModeCallbackErrorCode.PendingClientMismatch),
		).toBeVisible();
	});
});
