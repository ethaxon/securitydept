import * as fs from "node:fs";
import * as http from "node:http";

import { chromium, firefox, webkit } from "playwright";
import type { Browser, BrowserContext, BrowserContextOptions, LaunchOptions, Page } from "playwright";

type BrowserTypeName = "chromium" | "firefox" | "webkit";
type HeadersMap = Record<string, string>;
type LaunchOptionsWithArgs = LaunchOptions & {
	args?: string[];
	executablePath?: string;
};

export function resolveBrowserExecutablePath(browserType: BrowserTypeName = "chromium") {
	const envCandidatesByBrowser: Record<BrowserTypeName, Array<string | undefined>> = {
		chromium: [
			process.env.PW_CHROMIUM_EXECUTABLE_PATH,
			process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
			process.env.PW_BROWSER_EXECUTABLE_PATH,
			process.env.PLAYWRIGHT_BROWSER_EXECUTABLE_PATH,
		],
		firefox: [
			process.env.PW_FIREFOX_EXECUTABLE_PATH,
			process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH,
			process.env.PW_BROWSER_EXECUTABLE_PATH,
			process.env.PLAYWRIGHT_BROWSER_EXECUTABLE_PATH,
		],
		webkit: [
			process.env.PW_WEBKIT_EXECUTABLE_PATH,
			process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH,
			process.env.PW_BROWSER_EXECUTABLE_PATH,
			process.env.PLAYWRIGHT_BROWSER_EXECUTABLE_PATH,
		],
	};

	const defaultCandidatesByBrowser: Record<BrowserTypeName, string[]> = {
		chromium: [
			"/sbin/chromium",
			"/usr/bin/chromium",
			"/usr/bin/chromium-browser",
			"/bin/chromium",
			"/usr/bin/google-chrome",
			"/usr/bin/google-chrome-stable",
		],
		firefox: ["/usr/bin/firefox", "/bin/firefox"],
		webkit: [],
	};

	const candidates = [
		...(envCandidatesByBrowser[browserType] ?? []),
		...(defaultCandidatesByBrowser[browserType] ?? []),
	].filter(Boolean) as string[];

	return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function getAgentBrowserSupport() {
	return {
		chromium: {
			resolvedExecutablePath: resolveBrowserExecutablePath("chromium"),
			preferred: "system",
		},
		firefox: {
			resolvedExecutablePath: resolveBrowserExecutablePath("firefox"),
			preferred: "system",
		},
		webkit: {
			resolvedExecutablePath: resolveBrowserExecutablePath("webkit"),
			preferred: "bundled-or-ci",
		},
	};
}

export function getAgentLaunchOptions(
	browserType: BrowserTypeName = "chromium",
	options: LaunchOptionsWithArgs = {},
) {
	const resolvedExecutablePath =
		options.executablePath ?? resolveBrowserExecutablePath(browserType);
	const defaultArgs =
		browserType === "chromium"
			? ["--no-sandbox", "--disable-setuid-sandbox"]
			: [];

	const mergedArgs = Array.from(new Set([...(defaultArgs ?? []), ...(options.args ?? [])]));

	return {
		headless: process.env.HEADLESS === "true",
		slowMo: process.env.SLOW_MO ? Number.parseInt(process.env.SLOW_MO, 10) : 100,
		...options,
		...(mergedArgs.length > 0 ? { args: mergedArgs } : {}),
		...(resolvedExecutablePath ? { executablePath: resolvedExecutablePath } : {}),
	};
}

export function getExtraHeadersFromEnv(): HeadersMap | null {
	const headerName = process.env.PW_HEADER_NAME;
	const headerValue = process.env.PW_HEADER_VALUE;

	if (headerName && headerValue) {
		return { [headerName]: headerValue };
	}

	const headersJson = process.env.PW_EXTRA_HEADERS;
	if (headersJson) {
		try {
			const parsed = JSON.parse(headersJson);
			if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
				return parsed as HeadersMap;
			}
			console.warn("PW_EXTRA_HEADERS must be a JSON object, ignoring...");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn("Failed to parse PW_EXTRA_HEADERS as JSON:", message);
		}
	}

	return null;
}

export async function launchBrowser(
	browserType: BrowserTypeName = "chromium",
	options: LaunchOptionsWithArgs = {},
) {
	const browsers = { chromium, firefox, webkit };
	const browser = browsers[browserType];

	if (!browser) {
		throw new Error(`Invalid browser type: ${browserType}`);
	}

	return browser.launch(getAgentLaunchOptions(browserType, options));
}

export async function createPage(
	context: BrowserContext,
	options: {
		viewport?: { width: number; height: number };
		userAgent?: string;
		timeout?: number;
	} = {},
) {
	const page = await context.newPage();

	if (options.viewport) {
		await page.setViewportSize(options.viewport);
	}

	if (options.userAgent) {
		await page.setExtraHTTPHeaders({
			"User-Agent": options.userAgent,
		});
	}

	page.setDefaultTimeout(options.timeout ?? 30000);

	return page;
}

export async function waitForPageReady(
	page: Page,
	options: {
		waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
		timeout?: number;
		waitForSelector?: string;
	} = {},
) {
	const waitOptions = {
		waitUntil: options.waitUntil ?? "networkidle",
		timeout: options.timeout ?? 30000,
	};

	try {
		await page.waitForLoadState(waitOptions.waitUntil, {
			timeout: waitOptions.timeout,
		});
	} catch {
		console.warn("Page load timeout, continuing...");
	}

	if (options.waitForSelector) {
		await page.waitForSelector(options.waitForSelector, {
			timeout: options.timeout,
		});
	}
}

export async function safeClick(
	page: Page,
	selector: string,
	options: {
		retries?: number;
		retryDelay?: number;
		force?: boolean;
		timeout?: number;
	} = {},
) {
	const maxRetries = options.retries ?? 3;
	const retryDelay = options.retryDelay ?? 1000;

	for (let attempt = 0; attempt < maxRetries; attempt += 1) {
		try {
			await page.waitForSelector(selector, {
				state: "visible",
				timeout: options.timeout ?? 5000,
			});
			await page.click(selector, {
				force: options.force ?? false,
				timeout: options.timeout ?? 5000,
			});
			return true;
		} catch (error) {
			if (attempt === maxRetries - 1) {
				console.error(`Failed to click ${selector} after ${maxRetries} attempts`);
				throw error;
			}

			console.log(`Retry ${attempt + 1}/${maxRetries} for clicking ${selector}`);
			await page.waitForTimeout(retryDelay);
		}
	}

	return false;
}

export async function safeType(
	page: Page,
	selector: string,
	text: string,
	options: {
		timeout?: number;
		clear?: boolean;
		slow?: boolean;
		delay?: number;
	} = {},
) {
	await page.waitForSelector(selector, {
		state: "visible",
		timeout: options.timeout ?? 10000,
	});

	if (options.clear !== false) {
		await page.fill(selector, "");
	}

	if (options.slow) {
		await page.type(selector, text, { delay: options.delay ?? 100 });
		return;
	}

	await page.fill(selector, text);
}

export async function extractTexts(page: Page, selector: string) {
	await page.waitForSelector(selector, { timeout: 10000 });
	return page.$$eval(selector, (elements) =>
		elements.map((element) => element.textContent?.trim()).filter(Boolean),
	);
}

export async function takeScreenshot(
	page: Page,
	name: string,
	options: {
		fullPage?: boolean;
		path?: string;
		animations?: "disabled" | "allow";
		mask?: unknown[];
	} = {},
) {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const filename = `${name}-${timestamp}.png`;

	await page.screenshot({
		path: filename,
		fullPage: options.fullPage !== false,
		...options,
	});

	console.log(`Screenshot saved: ${filename}`);
	return filename;
}

export async function authenticate(
	page: Page,
	credentials: { username: string; password: string },
	selectors: {
		username?: string;
		password?: string;
		submit?: string;
		successIndicator?: string;
	} = {},
) {
	const defaultSelectors = {
		username: 'input[name="username"], input[name="email"], #username, #email',
		password: 'input[name="password"], #password',
		submit:
			'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign in")',
	};

	const finalSelectors = { ...defaultSelectors, ...selectors };

	await safeType(page, finalSelectors.username, credentials.username);
	await safeType(page, finalSelectors.password, credentials.password);
	await safeClick(page, finalSelectors.submit);

	await Promise.race([
		page.waitForNavigation({ waitUntil: "networkidle" }),
		page.waitForSelector(
			selectors.successIndicator ?? ".dashboard, .user-menu, .logout",
			{ timeout: 10000 },
		),
	]).catch(() => {
		console.log("Login might have completed without navigation");
	});
}

export async function scrollPage(
	page: Page,
	direction: "down" | "up" | "top" | "bottom" = "down",
	distance = 500,
) {
	switch (direction) {
		case "down":
			await page.evaluate((pixels) => window.scrollBy(0, pixels), distance);
			break;
		case "up":
			await page.evaluate((pixels) => window.scrollBy(0, -pixels), distance);
			break;
		case "top":
			await page.evaluate(() => window.scrollTo(0, 0));
			break;
		case "bottom":
			await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
			break;
	}

	await page.waitForTimeout(500);
}

export async function extractTableData(page: Page, tableSelector: string) {
	await page.waitForSelector(tableSelector);

	return page.evaluate((selector) => {
		const table = document.querySelector(selector);
		if (!table) {
			return null;
		}

		const headers = Array.from(table.querySelectorAll("thead th")).map((header) =>
			header.textContent?.trim(),
		);

		const rows = Array.from(table.querySelectorAll("tbody tr")).map((row) => {
			const cells = Array.from(row.querySelectorAll("td"));
			if (headers.length > 0) {
				return cells.reduce<Record<string, string | undefined>>((record, cell, index) => {
					record[headers[index] ?? `column_${index}`] = cell.textContent?.trim();
					return record;
				}, {});
			}

			return cells.map((cell) => cell.textContent?.trim());
		});

		return { headers, rows };
	}, tableSelector);
}

export async function handleCookieBanner(page: Page, timeout = 3000) {
	const commonSelectors = [
		'button:has-text("Accept")',
		'button:has-text("Accept all")',
		'button:has-text("OK")',
		'button:has-text("Got it")',
		'button:has-text("I agree")',
		".cookie-accept",
		"#cookie-accept",
		'[data-testid="cookie-accept"]',
	];

	for (const selector of commonSelectors) {
		try {
			const element = await page.waitForSelector(selector, {
				timeout: timeout / commonSelectors.length,
				state: "visible",
			});
			if (element) {
				await element.click();
				console.log("Cookie banner dismissed");
				return true;
			}
		} catch {
			// Continue to the next selector.
		}
	}

	return false;
}

export async function retryWithBackoff<T>(
	fn: () => Promise<T>,
	maxRetries = 3,
	initialDelay = 1000,
) {
	let lastError: unknown;

	for (let attempt = 0; attempt < maxRetries; attempt += 1) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;
			const delay = initialDelay * 2 ** attempt;
			console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	throw lastError;
}

export async function createContext(
	browser: Browser,
	options: BrowserContextOptions & {
		mobile?: boolean;
	} = {},
) {
	const envHeaders = getExtraHeadersFromEnv();
	const mergedHeaders = {
		...envHeaders,
		...options.extraHTTPHeaders,
	};

	const defaultOptions = {
		viewport: { width: 1280, height: 720 },
		userAgent: options.mobile
			? "Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1"
			: undefined,
		permissions: options.permissions ?? [],
		geolocation: options.geolocation,
		locale: options.locale ?? "en-US",
		timezoneId: options.timezoneId ?? "America/New_York",
		...(Object.keys(mergedHeaders).length > 0 ? { extraHTTPHeaders: mergedHeaders } : {}),
	};

	return browser.newContext({ ...defaultOptions, ...options });
}

export async function detectDevServers(customPorts: number[] = []) {
	const commonPorts = [3000, 3001, 3002, 5173, 8080, 8000, 4200, 5000, 9000, 1234];
	const allPorts = [...new Set([...commonPorts, ...customPorts])];
	const detectedServers: string[] = [];

	console.log("🔍 Checking for running dev servers...");

	for (const port of allPorts) {
		try {
			await new Promise<void>((resolve) => {
				const req = http.request(
					{
						hostname: "localhost",
						port,
						path: "/",
						method: "HEAD",
						timeout: 500,
					},
					(res) => {
						if ((res.statusCode ?? 500) < 500) {
							detectedServers.push(`http://localhost:${port}`);
							console.log(`  ✅ Found server on port ${port}`);
						}
						resolve();
					},
				);

				req.on("error", () => resolve());
				req.on("timeout", () => {
					req.destroy();
					resolve();
				});

				req.end();
			});
		} catch {
			// Continue scanning other ports.
		}
	}

	if (detectedServers.length === 0) {
		console.log("  ❌ No dev servers detected");
	}

	return detectedServers;
}