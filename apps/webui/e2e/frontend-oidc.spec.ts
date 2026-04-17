import { expect, test } from "@playwright/test";
import { FrontendOidcModeCallbackErrorCode } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	frontendPlaygroundPath,
	frontendPopupCallbackPath,
} from "./support/constants.ts";
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

async function completeFrontendModePopupLogin(
	page: import("@playwright/test").Page,
) {
	await page.goto(frontendPlaygroundPath);
	const popupPromise = page.waitForEvent("popup");
	await page.getByRole("button", { name: "Start popup login" }).click();

	const popup = await popupPromise;
	await expect(popup.locator("#oidc-login")).toBeVisible();
	await popup.locator("#oidc-login").fill("e2e-user");
	await popup.locator("#oidc-password").fill("e2e-password");
	await popup.locator("#oidc-submit").click();

	await expect(popup.locator("#oidc-approve")).toBeVisible();
	const popupCallbackArrival = popup.waitForURL(
		new RegExp(`${frontendPopupCallbackPath.replaceAll("/", "\\/")}\\?`),
	);
	const popupClosed = popup.waitForEvent("close");
	await popup.locator("#oidc-approve").click();
	await popupCallbackArrival;
	await popupClosed;

	await expect(
		page.getByRole("button", { name: "Refresh tokens" }),
	).toBeEnabled();
}

test.describe("frontend-mode browser callback", () => {
	test("restores the playground route after a real browser-owned callback", async ({
		page,
	}) => {
		await completeFrontendModeLogin(page);

		await expect(page).toHaveURL(frontendPlaygroundPath);
		await expect(
			page.getByRole("heading", {
				name: "Browser-owned popup and callback reference path",
			}),
		).toBeVisible();
		await expect(page.getByText("Popup relay route")).toBeVisible();
	});

	test("completes popup login through the app-owned relay route", async ({
		page,
	}) => {
		await completeFrontendModePopupLogin(page);

		await expect(page).toHaveURL(frontendPlaygroundPath);
		await expect(
			page.getByText(
				"cross-tab lifecycle all land inside the same browser-owned host",
			),
		).toBeVisible();
		await expect(page.getByText("has_access_token=true")).toBeVisible();
		await expect(
			page.locator('[data-trace-type="frontend_oidc.popup.opened"]').first(),
		).toBeVisible();
		await expect(
			page
				.locator('[data-trace-type="frontend_oidc.popup.relay.succeeded"]')
				.first(),
		).toBeVisible();
	});

	test("surfaces popup closed-by-user as a host-visible error", async ({
		page,
	}) => {
		await page.goto(frontendPlaygroundPath);
		const popupPromise = page.waitForEvent("popup");
		await page.getByRole("button", { name: "Start popup login" }).click();

		const popup = await popupPromise;
		await popup.close();

		await expect(page.getByText("Popup login was closed")).toBeVisible();
		await expect(
			page.locator('[data-error-code="popup.closed_by_user"]'),
		).toBeVisible();
		await expect(
			page.locator('[data-error-recovery="restart_flow"]'),
		).toBeVisible();
	});

	test("hydrates another tab from cross-tab storage authority", async ({
		browser,
	}) => {
		const context = await browser.newContext();
		const primaryPage = await context.newPage();
		const followerPage = await context.newPage();

		await followerPage.goto(frontendPlaygroundPath);
		await expect(
			followerPage.getByText(
				"Waiting for another tab to update this frontend-mode client",
			),
		).toBeVisible();

		await completeFrontendModeLogin(primaryPage);

		await expect(
			followerPage.getByText(
				"Another tab updated this frontend-mode client and this page reconciled the persisted snapshot",
			),
		).toBeVisible();
		await expect(
			followerPage.getByRole("button", { name: "Refresh tokens" }),
		).toBeEnabled();
		await expect(followerPage.getByText("has_access_token=true")).toBeVisible();
		await expect(
			followerPage
				.locator('[data-trace-type="frontend_oidc.host.cross_tab.hydrated"]')
				.first(),
		).toBeVisible();

		await primaryPage
			.getByRole("button", { name: "Forget frontend-mode state" })
			.click();

		await expect(
			followerPage.getByText(
				"Another tab cleared the persisted frontend-mode snapshot and this page dropped its in-memory state",
			),
		).toBeVisible();
		await expect(
			followerPage.getByText("has_access_token=false"),
		).toBeVisible();
		await expect(
			followerPage
				.locator('[data-trace-type="frontend_oidc.host.cross_tab.cleared"]')
				.first(),
		).toBeVisible();

		await context.close();
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
			page.locator('[data-error-code="callback.duplicate_state"]'),
		).toBeVisible();
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
			page.locator('[data-error-code="callback.unknown_state"]'),
		).toBeVisible();
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
