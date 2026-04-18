import { expect, test } from "@playwright/test";
import {
	BrowserAvailability,
	ExecutionBaseline,
	ExecutionBaselineRole,
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
import {
	basicAuthLoginPath,
	basicAuthLogoutPath,
	basicAuthPlaygroundPath,
	serverBaseUrl,
} from "./support/constants.ts";

const basicAuthTestAccount = {
	username: "admin",
	password: "admin",
};

function encodeBasicAuthorization(username: string, password: string): string {
	return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

const challengeErrorPatterns: Record<string, RegExp> = {
	chromium: /ERR_INVALID_AUTH_CREDENTIALS/,
	firefox: /NS_ERROR/,
};

test.describe("basic-auth browser boundary", () => {
	test("keeps guarantee and observed browser behavior distinct on the reference page", async ({
		browser,
		page,
		browserName,
	}) => {
		const browserKey = browserName as HarnessBrowserName;
		const nativeScenario = getVerifiedScenario(
			VerifiedScenarioId.BasicAuthChallengeNoCachedCredentials,
			browserKey,
		);
		const harnessScenario = getVerifiedScenario(
			VerifiedScenarioId.BasicAuthLogoutAuthorizationHeaderHarness,
			browserKey,
		);
		expect(nativeScenario).toBeDefined();
		expect(nativeScenario?.pathKind).toBe(VerifiedPathKind.BrowserNative);
		expect(nativeScenario?.status).toBe(VerifiedStatus.Verified);

		expect(harnessScenario).toBeDefined();
		expect(harnessScenario?.pathKind).toBe(VerifiedPathKind.HarnessBacked);
		expect(harnessScenario?.status).toBe(VerifiedStatus.Verified);

		const suiteScenarios = getVerifiedScenariosForSuite("basic-auth");
		const verifiedCount = suiteScenarios.filter(
			(s) => s.status === VerifiedStatus.Verified,
		).length;
		expect(verifiedCount).toBeGreaterThanOrEqual(2);

		const currentBrowserPolicy = getExecutionBaselinePolicy(browserKey);
		expect(currentBrowserPolicy).toBeDefined();
		if (browserKey === HarnessBrowserNameValues.Webkit) {
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

		await page.goto(basicAuthPlaygroundPath);

		await expect(
			page.getByRole("heading", { name: "Challenge-boundary reference page" }),
		).toBeVisible();
		await expect(
			page.locator('[data-basic-boundary-kind="unauthorized"]'),
		).toBeVisible();
		await expect(page.getByText("Guaranteed protocol contract")).toBeVisible();
		await expect(page.getByText("Verified browser baseline")).toBeVisible();
		await expect(page.getByText("Observed in this browser")).toBeVisible();
		await expect(page.getByText("Remaining unknowns")).toBeVisible();
		await expect(
			page.getByText("primary-authority baseline for Basic Auth evidence"),
		).toBeVisible();
		await expect(
			page.getByText(
				"canonical recovery path for verified browser-owned evidence",
			),
		).toBeVisible();

		const errorPattern = challengeErrorPatterns[browserName] ?? /ERR_|NS_ERROR/;
		const challengePage = await browser.newPage();
		if (browserName === "webkit") {
			const challengeResponse = await challengePage.goto(
				`${basicAuthLoginPath}?post_auth_redirect_uri=%2Fplayground%2Fbasic-auth`,
				{ waitUntil: "commit" },
			);
			expect(challengeResponse?.status()).toBe(401);
			expect(challengeResponse?.headers()["www-authenticate"]).toContain(
				'Basic realm="securitydept"',
			);
		} else {
			await expect(
				challengePage.goto(
					`${basicAuthLoginPath}?post_auth_redirect_uri=%2Fplayground%2Fbasic-auth`,
					{ waitUntil: "commit" },
				),
			).rejects.toThrow(errorPattern);
		}
		await challengePage.close();
		const logoutResult = await page.evaluate(async (logoutPath) => {
			const response = await fetch(logoutPath, {
				method: "POST",
				headers: { Accept: "application/json" },
			});
			return {
				status: response.status,
				challenge: response.headers.get("WWW-Authenticate"),
			};
		}, basicAuthLogoutPath);

		expect(logoutResult).toEqual({
			status: 401,
			challenge: null,
		});

		await page.goto(basicAuthPlaygroundPath);
		await expect(
			page.locator('[data-basic-boundary-kind="unauthorized"]'),
		).toBeVisible();
		await expect(page.locator("[data-harness-verified-browser]")).toBeVisible();
		await expect(page.locator("[data-harness-blocked-browsers]")).toBeVisible();
		if (
			getProjectCapability("webkit")?.availability ===
			BrowserAvailability.Blocked
		) {
			await expect(
				page.getByText("host-native WebKit can still block before auth-flow"),
			).toBeVisible();
			await expect(page.getByText("host-truth")).toBeVisible();
		}
	});

	test("records the authenticated logout path under a harness-supplied credential context", async ({
		browser,
		browserName,
	}) => {
		const browserKey = browserName as HarnessBrowserName;
		const harnessScenario = getVerifiedScenario(
			VerifiedScenarioId.BasicAuthLogoutAuthorizationHeaderHarness,
			browserKey,
		);
		expect(harnessScenario).toBeDefined();
		expect(harnessScenario?.pathKind).toBe(VerifiedPathKind.HarnessBacked);
		expect(harnessScenario?.harnessId).toBe("authorization-header-context");

		const context = await browser.newContext({
			extraHTTPHeaders: {
				Authorization: encodeBasicAuthorization(
					basicAuthTestAccount.username,
					basicAuthTestAccount.password,
				),
			},
		});
		const page = await context.newPage();

		const initialProtectedResponse = await page.goto(
			`${serverBaseUrl}/basic/api/entries`,
		);
		expect(initialProtectedResponse).not.toBeNull();
		expect(initialProtectedResponse?.status()).toBe(200);

		const logoutResult = await page.evaluate(async (logoutPath) => {
			const response = await fetch(logoutPath, {
				method: "POST",
				headers: { Accept: "application/json" },
			});
			return {
				status: response.status,
				challenge: response.headers.get("WWW-Authenticate"),
			};
		}, basicAuthLogoutPath);

		expect(logoutResult).toEqual({
			status: 401,
			challenge: null,
		});

		const postLogoutProtectedResult = await page.evaluate(async () => {
			const response = await fetch("/basic/api/entries", {
				method: "GET",
				headers: { Accept: "application/json" },
			});
			return {
				status: response.status,
				challenge: response.headers.get("WWW-Authenticate"),
			};
		});

		expect(postLogoutProtectedResult).toEqual({
			status: 200,
			challenge: null,
		});

		await context.close();
	});
});
