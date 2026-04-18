import { expect, test } from "@playwright/test";
import { FrontendOidcModeCallbackErrorCode } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	AuthFlowSuiteId,
	BlockedReason,
	BrowserAvailability,
	ExecutionBaseline,
	ExecutionBaselineRole,
	getAvailableBrowserNames,
	getExecutionBaselinePolicy,
	getProjectCapability,
	getVerifiedScenario,
	getVerifiedScenariosForSuite,
	HarnessBrowserName as HarnessBrowserNameValues,
	VerifiedPathKind,
	VerifiedScenarioId,
	VerifiedStatus,
} from "./support/browser-harness.ts";
import type { HarnessBrowserName } from "./support/browser-harness-contract.ts";
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
	const popupClosed = popup.waitForEvent("close");
	await popup.locator("#oidc-approve").click();
	await popupClosed;
	await expect(
		page
			.locator('[data-trace-type="frontend_oidc.popup.relay.succeeded"]')
			.first(),
	).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText("has_access_token=true")).toBeVisible({
		timeout: 30_000,
	});

	await expect(
		page.getByRole("button", { name: "Refresh tokens" }),
	).toBeEnabled({ timeout: 30_000 });
}

test.describe("frontend-mode browser callback", () => {
	test("validates browser harness baseline for frontend-oidc suite", ({
		browserName,
	}) => {
		const browser = browserName as HarnessBrowserName;
		const availableBrowsers = getAvailableBrowserNames();
		expect(availableBrowsers).toContain(browser);
		const currentBrowserPolicy = getExecutionBaselinePolicy(browser);
		expect(currentBrowserPolicy).toBeDefined();
		if (browser === HarnessBrowserNameValues.Webkit) {
			expect(currentBrowserPolicy?.preferredExecutionBaseline).toBe(
				ExecutionBaseline.DistroboxHosted,
			);
			expect(currentBrowserPolicy?.hostNative.role).toBe(
				ExecutionBaselineRole.HostTruth,
			);
			expect(currentBrowserPolicy?.distroboxHosted.role).toBe(
				ExecutionBaselineRole.CanonicalRecoveryPath,
			);
		} else {
			expect(currentBrowserPolicy?.preferredExecutionBaseline).toBe(
				ExecutionBaseline.HostNative,
			);
			expect(currentBrowserPolicy?.hostNative.role).toBe(
				ExecutionBaselineRole.PrimaryAuthority,
			);
			expect(currentBrowserPolicy?.distroboxHosted.role).toBe(
				ExecutionBaselineRole.NotAdopted,
			);
		}
		const suiteScenarios = getVerifiedScenariosForSuite(
			AuthFlowSuiteId.FrontendOidc,
		);
		const verifiedCount = suiteScenarios.filter(
			(s) => s.status === VerifiedStatus.Verified,
		).length;
		expect(verifiedCount).toBeGreaterThanOrEqual(8);

		const callbackScenario = getVerifiedScenario(
			VerifiedScenarioId.FrontendOidcCallbackRedirect,
			browser,
		);
		expect(callbackScenario).toBeDefined();
		expect(callbackScenario?.pathKind).toBe(VerifiedPathKind.BrowserNative);
		expect(callbackScenario?.status).toBe(VerifiedStatus.Verified);

		const popupRelayScenario = getVerifiedScenario(
			VerifiedScenarioId.FrontendOidcPopupRelay,
			browser,
		);
		expect(popupRelayScenario).toBeDefined();
		expect(popupRelayScenario?.pathKind).toBe(VerifiedPathKind.BrowserNative);
		expect(popupRelayScenario?.status).toBe(VerifiedStatus.Verified);

		const crossTabScenario = getVerifiedScenario(
			VerifiedScenarioId.FrontendOidcCrossTabStorage,
			browser,
		);
		expect(crossTabScenario).toBeDefined();
		expect(crossTabScenario?.pathKind).toBe(VerifiedPathKind.BrowserNative);
		expect(crossTabScenario?.status).toBe(VerifiedStatus.Verified);

		const popupClosedScenario = getVerifiedScenario(
			VerifiedScenarioId.FrontendOidcPopupClosedByUser,
			browser,
		);
		expect(popupClosedScenario).toBeDefined();
		expect(popupClosedScenario?.pathKind).toBe(VerifiedPathKind.BrowserNative);
		expect(popupClosedScenario?.status).toBe(VerifiedStatus.Verified);

		const duplicateReplayScenario = getVerifiedScenario(
			VerifiedScenarioId.FrontendOidcCallbackDuplicateReplay,
			browser,
		);
		expect(duplicateReplayScenario).toBeDefined();
		expect(duplicateReplayScenario?.pathKind).toBe(
			VerifiedPathKind.BrowserNative,
		);
		expect(duplicateReplayScenario?.status).toBe(VerifiedStatus.Verified);

		const unknownStateScenario = getVerifiedScenario(
			VerifiedScenarioId.FrontendOidcCallbackUnknownState,
			browser,
		);
		expect(unknownStateScenario).toBeDefined();
		expect(unknownStateScenario?.pathKind).toBe(VerifiedPathKind.BrowserNative);
		expect(unknownStateScenario?.status).toBe(VerifiedStatus.Verified);

		const staleStateScenario = getVerifiedScenario(
			VerifiedScenarioId.FrontendOidcCallbackStaleState,
			browser,
		);
		expect(staleStateScenario).toBeDefined();
		expect(staleStateScenario?.pathKind).toBe(VerifiedPathKind.BrowserNative);
		expect(staleStateScenario?.status).toBe(VerifiedStatus.Verified);

		const clientMismatchScenario = getVerifiedScenario(
			VerifiedScenarioId.FrontendOidcCallbackClientMismatch,
			browser,
		);
		expect(clientMismatchScenario).toBeDefined();
		expect(clientMismatchScenario?.pathKind).toBe(
			VerifiedPathKind.BrowserNative,
		);
		expect(clientMismatchScenario?.status).toBe(VerifiedStatus.Verified);
		const webkitCapability = getProjectCapability(
			HarnessBrowserNameValues.Webkit,
		);
		expect(webkitCapability).toBeDefined();
		if (webkitCapability?.availability === BrowserAvailability.Blocked) {
			expect(webkitCapability.executionBaseline).toBe(
				ExecutionBaseline.HostNative,
			);
			expect(webkitCapability.blockedReason).toBe(
				BlockedReason.HostDependenciesMissing,
			);
			expect(webkitCapability.blockedDetails).toContain(
				"Missing host libraries observed from runtime probe",
			);
		} else {
			expect(webkitCapability?.availability).toBe(
				BrowserAvailability.Available,
			);
			expect(webkitCapability?.executionBaseline).toBe(
				ExecutionBaseline.DistroboxHosted,
			);
		}

		const webkitCallback = getVerifiedScenario(
			VerifiedScenarioId.FrontendOidcCallbackRedirect,
			HarnessBrowserNameValues.Webkit,
		);
		expect(webkitCallback).toBeDefined();
		if (webkitCapability?.availability === BrowserAvailability.Blocked) {
			expect(webkitCallback?.status).toBe(VerifiedStatus.Blocked);
			expect(webkitCallback?.blockedReason).toBe(
				BlockedReason.HostDependenciesMissing,
			);
			expect(webkitCallback?.blockedDetails).toContain(
				"Missing host libraries observed from runtime probe",
			);
		} else {
			expect(webkitCallback?.status).toBe(VerifiedStatus.Verified);
		}
	});

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
