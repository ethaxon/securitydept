import { expect, test } from "@playwright/test";
import {
	ExecutionBaseline,
	ExecutionBaselineRole,
	getExecutionBaselinePolicy,
	getVerifiedScenario,
	getVerifiedScenariosForSuite,
	HarnessBrowserName as HarnessBrowserNameValues,
	VerifiedPathKind,
	VerifiedScenarioId,
	VerifiedStatus,
} from "./support/browser-harness.ts";
import { type HarnessBrowserName } from "./support/browser-harness-contract.ts";
import {
	basicAuthLoginPath,
	basicAuthPlaygroundPath,
	serverBaseUrl,
} from "./support/constants.ts";
import { shouldPreferDistroboxHostedWebkit } from "./support/host-platform.ts";

const challengeErrorPatterns: Record<string, RegExp> = {
	chromium:
		/ERR_(?:EMPTY_RESPONSE|INVALID_AUTH_CREDENTIALS|HTTP_RESPONSE_CODE_FAILURE)/,
	firefox: /NS_ERROR/,
	webkit: /network connection was lost/i,
};

const preferDistroboxHostedWebkit = shouldPreferDistroboxHostedWebkit();

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
		expect(nativeScenario).toBeDefined();
		expect(nativeScenario?.pathKind).toBe(VerifiedPathKind.BrowserNative);
		expect(nativeScenario?.status).toBe(VerifiedStatus.Verified);

		const suiteScenarios = getVerifiedScenariosForSuite("basic-auth");
		const verifiedCount = suiteScenarios.filter(
			(s) => s.status === VerifiedStatus.Verified,
		).length;
		expect(verifiedCount).toBeGreaterThanOrEqual(1);

		const currentBrowserPolicy = getExecutionBaselinePolicy(browserKey);
		expect(currentBrowserPolicy).toBeDefined();
		if (browserKey === HarnessBrowserNameValues.Webkit) {
			expect(currentBrowserPolicy?.preferredExecutionBaseline).toBe(
				preferDistroboxHostedWebkit
					? ExecutionBaseline.DistroboxHosted
					: ExecutionBaseline.HostNative,
			);
			expect(currentBrowserPolicy?.hostNative.role).toBe(
				preferDistroboxHostedWebkit
					? ExecutionBaselineRole.HostTruth
					: ExecutionBaselineRole.PrimaryAuthority,
			);
			expect(currentBrowserPolicy?.distroboxHosted.role).toBe(
				preferDistroboxHostedWebkit
					? ExecutionBaselineRole.CanonicalRecoveryPath
					: ExecutionBaselineRole.NotAdopted,
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
			page.getByRole("heading", { name: "Basic Auth" }),
		).toBeVisible();
		await expect(
			page.locator('[data-basic-boundary-kind="unauthorized"]'),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Current observation" }),
		).toBeVisible();

		const challengeUrl = `${serverBaseUrl}${basicAuthLoginPath}?post_auth_redirect_uri=%2Fplayground%2Fbasic-auth`;
		const errorPattern = challengeErrorPatterns[browserName] ?? /ERR_|NS_ERROR/;
		const challengePage = await browser.newPage();
		try {
			try {
				const challengeResponse = await challengePage.goto(challengeUrl, {
					waitUntil: "commit",
				});
				expect(challengeResponse?.status()).toBe(401);
				expect(challengeResponse?.headers()["www-authenticate"]).toContain(
					'Basic realm="securitydept"',
				);
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).message).toMatch(errorPattern);
			}
		} finally {
			await challengePage.close();
		}
		await page.goto(basicAuthPlaygroundPath);
		await expect(
			page.locator('[data-basic-boundary-kind="unauthorized"]'),
		).toBeVisible();
	});
});
