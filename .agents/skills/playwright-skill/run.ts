#!/usr/bin/env node
/**
 * Universal Playwright Executor for Claude Code
 *
 * Executes Playwright automation code from:
 * - File path: node run.ts script.ts
 * - Inline code: node run.ts 'await page.goto("...")'
 * - Stdin: cat script.ts | node run.ts
 *
 * Ensures proper module resolution by running from the skill directory.
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as helpers from "./lib/helpers.ts";

const require = createRequire(import.meta.url);
const skillDir = path.dirname(fileURLToPath(import.meta.url));

process.chdir(skillDir);

function checkPlaywrightInstalled() {
	try {
		require.resolve("playwright");
		return true;
	} catch {
		return false;
	}
}

function installPlaywright() {
	console.log("📦 Playwright not found. Installing...");

	try {
		execSync("npm install", { stdio: "inherit", cwd: skillDir });

		const browserSupport = helpers.getAgentBrowserSupport();
		if (!browserSupport.chromium.resolvedExecutablePath) {
			console.warn("⚠️ No system Chromium executable detected.");
			console.warn(
				"Set PW_CHROMIUM_EXECUTABLE_PATH or run: npm run setup:browsers",
			);
		}

		console.log("✅ Playwright packages installed successfully");
		return true;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error("❌ Failed to install Playwright:", message);
		console.error("Please run manually: cd", skillDir, "&& npm run setup");
		return false;
	}
}

function getCodeToExecute() {
	const args = process.argv.slice(2);

	if (args.length > 0 && existsSync(args[0])) {
		const filePath = path.resolve(args[0]);
		console.log(`📄 Executing file: ${filePath}`);
		return readFileSync(filePath, "utf8");
	}

	if (args.length > 0) {
		console.log("⚡ Executing inline code");
		return args.join(" ");
	}

	if (!process.stdin.isTTY) {
		console.log("📥 Reading from stdin");
		return readFileSync(0, "utf8");
	}

	console.error("❌ No code to execute");
	console.error("Usage:");
	console.error("  node run.ts script.ts          # Execute file");
	console.error('  node run.ts "code here"        # Execute inline');
	console.error("  cat script.ts | node run.ts    # Execute from stdin");
	process.exit(1);
	return "";
}

function cleanupOldTempFiles() {
	try {
		const files = readdirSync(skillDir);
		const tempFiles = files.filter(
			(file) =>
				file.startsWith(".temp-execution-") &&
				(file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".ts")),
		);

		for (const file of tempFiles) {
			try {
				unlinkSync(path.join(skillDir, file));
			} catch {
				// Ignore cleanup errors.
			}
		}
	} catch {
		// Ignore directory read errors.
	}
}

function prependCommonJsCompat(code: string) {
	return `
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

${code}
`;
}

function wrapCodeIfNeeded(code: string) {
	const hasRequire = code.includes("require(");
	const hasModuleSyntax = /^\s*(import|export)\s/m.test(code);
	const hasAsyncIife =
		code.includes("(async () => {") ||
		code.includes("(async()=>{") ||
		code.includes("(async function");

	if (hasModuleSyntax) {
		return code;
	}

	if (hasRequire && hasAsyncIife) {
		return prependCommonJsCompat(code);
	}

	if (!hasRequire) {
		return `
import { chromium, firefox, webkit, devices } from "playwright";
import * as helpers from "./lib/helpers.ts";

const launchBrowser = (browserType = "chromium", options = {}) =>
  helpers.launchBrowser(browserType, options);

const __extraHeaders = helpers.getExtraHeadersFromEnv();

function getContextOptionsWithHeaders(options = {}) {
  if (!__extraHeaders) {
    return options;
  }

  return {
    ...options,
    extraHTTPHeaders: {
      ...__extraHeaders,
      ...(options.extraHTTPHeaders || {}),
    },
  };
}

(async () => {
  try {
    ${code}
  } catch (error) {
    console.error("❌ Automation error:", error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
})();
`;
	}

	if (!hasAsyncIife) {
		return prependCommonJsCompat(`
(async () => {
  try {
    ${code}
  } catch (error) {
    console.error("❌ Automation error:", error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
})();
`);
	}

	return prependCommonJsCompat(code);
}

async function executeTempModule(tempFile: string) {
	const tempModuleUrl = new URL(`${pathToFileURL(tempFile).href}?ts=${Date.now()}`);
	await import(tempModuleUrl.href);
}

async function main() {
	console.log("🎭 Playwright Skill - Universal Executor\n");

	const browserSupport = helpers.getAgentBrowserSupport();
	if (browserSupport.chromium.resolvedExecutablePath) {
		console.log(
			`🧭 Using system Chromium: ${browserSupport.chromium.resolvedExecutablePath}`,
		);
	}

	cleanupOldTempFiles();

	if (!checkPlaywrightInstalled()) {
		const installed = installPlaywright();
		if (!installed) {
			process.exit(1);
		}
	}

	const rawCode = getCodeToExecute();
	const code = wrapCodeIfNeeded(rawCode);
	const tempFile = path.join(skillDir, `.temp-execution-${Date.now()}.ts`);

	try {
		writeFileSync(tempFile, code, "utf8");
		console.log("🚀 Starting automation...\n");
		await executeTempModule(tempFile);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error("❌ Execution failed:", message);
		if (error instanceof Error && error.stack) {
			console.error("\n📋 Stack trace:");
			console.error(error.stack);
		}
		process.exit(1);
	} finally {
		try {
			unlinkSync(tempFile);
		} catch {
			// Ignore temp cleanup errors.
		}
	}
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error("❌ Fatal error:", message);
	process.exit(1);
});