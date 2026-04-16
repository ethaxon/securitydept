---
name: playwright-skill
description: Complete browser automation with Playwright. Auto-detects dev servers, writes clean test scripts to /tmp. Test pages, fill forms, take screenshots, check responsive design, validate UX, test login flows, check links, automate any browser task. Use when user wants to test websites, automate browser interactions, validate web functionality, or perform any browser-based testing.
---

**IMPORTANT - Path Resolution:**
This skill can be installed in different locations (plugin system, manual installation, global, or project-specific). Before executing any commands, determine the skill directory based on where you loaded this SKILL.md file, and use that path in all commands below. Replace `$SKILL_DIR` with the actual discovered path.

Common installation paths:

- Plugin system: `~/.claude/plugins/marketplaces/playwright-skill/skills/playwright-skill`
- Manual global: `~/.claude/skills/playwright-skill`
- Project-specific: `<project>/.claude/skills/playwright-skill`

For this repository, the canonical project install location is:

- Shared project skill root: `<project>/.agents/skills/playwright-skill`
- Agent-facing skill links: `<project>/.claude/skills`, `<project>/.codex/skills`, `<project>/.gemini/skills` -> `<project>/.agents/skills`

# Playwright Browser Automation

This project-specific variant is tuned for AI agent usage:

- Prefer `playwright-cli` for token-efficient, session-oriented browser interaction
- Keep `node run.ts /tmp/playwright-test-*.ts` as the fallback for custom multi-step automation
- Prefer system browsers on Linux/Arch/Manjaro instead of forcing bundled Playwright browser downloads
- Use the shared `.agents/skills` install and expose it to agent-specific directories via symlinks

General-purpose browser automation skill. I'll write custom Playwright code for any automation task you request and execute it via the universal executor.

**CRITICAL WORKFLOW - Follow these steps in order:**

1. **Prefer `playwright-cli` for quick interactive work** - Use the CLI first when the task is page inspection, snapshotting, click/type flows, storage inspection, or short session-based reproduction:

  ```bash
  cd $SKILL_DIR && npx playwright-cli --help
  cd $SKILL_DIR && npx playwright-cli open http://localhost:3000 --headed
  cd $SKILL_DIR && npx playwright-cli snapshot
  ```

  Use `playwright-cli` when a concise command sequence is enough. Use `node run.ts /tmp/playwright-test-*.ts` when the task needs custom logic, loops, assertions, network hooks, or screenshots/reporting under one script.

2. **Auto-detect dev servers** - For localhost testing, ALWAYS run server detection FIRST:

   ```bash
  cd $SKILL_DIR && node --input-type=module -e "const { detectDevServers } = await import('./lib/helpers.ts'); console.log(JSON.stringify(await detectDevServers()))"
   ```

   - If **1 server found**: Use it automatically, inform user
   - If **multiple servers found**: Ask user which one to test
   - If **no servers found**: Ask for URL or offer to help start dev server

3. **Write scripts to /tmp** - NEVER write test files to skill directory; always use `/tmp/playwright-test-*.ts`

4. **Use visible browser by default** - Always use `headless: false` unless user specifically requests headless mode

5. **Prefer `helpers.launchBrowser()`** - It applies project defaults, visible mode, slow motion, and system browser executable discovery automatically

6. **Parameterize URLs** - Always make URLs configurable via environment variable or constant at top of script

## How It Works

1. You describe what you want to test/automate
2. I auto-detect running dev servers (or ask for URL if testing external site)
3. I write custom Playwright code in `/tmp/playwright-test-*.ts` (won't clutter your project)
4. I execute it via: `cd $SKILL_DIR && node run.ts /tmp/playwright-test-*.ts`
5. Results displayed in real-time, browser window visible for debugging
6. Test files auto-cleaned from /tmp by your OS

## Setup (First Time)

```bash
cd $SKILL_DIR
npm run setup
```

This installs the Node packages for the skill, including `playwright` and `@playwright/cli`, then prints detected system browser support.

On Arch/Manjaro/Linux, this skill prefers a system browser instead of forcing bundled browser downloads.

Recommended environment overrides when auto-detection is not enough:

```bash
export PW_CHROMIUM_EXECUTABLE_PATH=/sbin/chromium
export PW_FIREFOX_EXECUTABLE_PATH=/usr/bin/firefox
```

Optional fallback if you explicitly want Playwright-managed browsers:

```bash
cd $SKILL_DIR
npm run setup:browsers
```

To inspect the official CLI surface directly:

```bash
cd $SKILL_DIR
npx playwright-cli --help
```

## Execution Pattern

### Fast path: CLI-first browser interaction

```bash
cd $SKILL_DIR && npx playwright-cli open http://localhost:3000 --headed
cd $SKILL_DIR && npx playwright-cli snapshot
cd $SKILL_DIR && npx playwright-cli click e15
cd $SKILL_DIR && npx playwright-cli screenshot
```

Use this path for short, token-efficient agent interactions.

### Full path: Custom Playwright script via universal executor

**Step 1: Detect dev servers (for localhost testing)**

```bash
cd $SKILL_DIR && node --input-type=module -e "const { detectDevServers } = await import('./lib/helpers.ts'); console.log(JSON.stringify(await detectDevServers()))"
```

**Step 2: Write test script to /tmp with URL parameter**

```typescript
// /tmp/playwright-test-page.ts
import * as helpers from './lib/helpers.ts';

// Parameterized URL (detected or user-provided)
const TARGET_URL = 'http://localhost:3001'; // <-- Auto-detected or from user

(async () => {
  const browser = await helpers.launchBrowser('chromium');
  const page = await browser.newPage();

  await page.goto(TARGET_URL);
  console.log('Page loaded:', await page.title());

  await page.screenshot({ path: '/tmp/screenshot.png', fullPage: true });
  console.log('📸 Screenshot saved to /tmp/screenshot.png');

  await browser.close();
})();
```

**Step 3: Execute from skill directory**

```bash
cd $SKILL_DIR && node run.ts /tmp/playwright-test-page.ts
```

## Common Patterns

### Test a Page (Multiple Viewports)

```typescript
// /tmp/playwright-test-responsive.ts
import * as helpers from './lib/helpers.ts';

const TARGET_URL = 'http://localhost:3001'; // Auto-detected

(async () => {
  const browser = await helpers.launchBrowser('chromium', { slowMo: 100 });
  const page = await browser.newPage();

  // Desktop test
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(TARGET_URL);
  console.log('Desktop - Title:', await page.title());
  await page.screenshot({ path: '/tmp/desktop.png', fullPage: true });

  // Mobile test
  await page.setViewportSize({ width: 375, height: 667 });
  await page.screenshot({ path: '/tmp/mobile.png', fullPage: true });

  await browser.close();
})();
```

### Test Login Flow

```typescript
// /tmp/playwright-test-login.ts
import * as helpers from './lib/helpers.ts';

const TARGET_URL = 'http://localhost:3001'; // Auto-detected

(async () => {
  const browser = await helpers.launchBrowser('chromium');
  const page = await browser.newPage();

  await page.goto(`${TARGET_URL}/login`);

  await page.fill('input[name="email"]', 'test@example.com');
  await page.fill('input[name="password"]', 'password123');
  await page.click('button[type="submit"]');

  // Wait for redirect
  await page.waitForURL('**/dashboard');
  console.log('✅ Login successful, redirected to dashboard');

  await browser.close();
})();
```

### Fill and Submit Form

```typescript
// /tmp/playwright-test-form.ts
import * as helpers from './lib/helpers.ts';

const TARGET_URL = 'http://localhost:3001'; // Auto-detected

(async () => {
  const browser = await helpers.launchBrowser('chromium', { slowMo: 50 });
  const page = await browser.newPage();

  await page.goto(`${TARGET_URL}/contact`);

  await page.fill('input[name="name"]', 'John Doe');
  await page.fill('input[name="email"]', 'john@example.com');
  await page.fill('textarea[name="message"]', 'Test message');
  await page.click('button[type="submit"]');

  // Verify submission
  await page.waitForSelector('.success-message');
  console.log('✅ Form submitted successfully');

  await browser.close();
})();
```

### Check for Broken Links

```typescript
import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto('http://localhost:3000');

  const links = await page.locator('a[href^="http"]').all();
  const results = { working: 0, broken: [] };

  for (const link of links) {
    const href = await link.getAttribute('href');
    try {
      const response = await page.request.head(href);
      if (response.ok()) {
        results.working++;
      } else {
        results.broken.push({ url: href, status: response.status() });
      }
    } catch (e) {
      results.broken.push({ url: href, error: e.message });
    }
  }

  console.log(`✅ Working links: ${results.working}`);
  console.log(`❌ Broken links:`, results.broken);

  await browser.close();
})();
```

### Take Screenshot with Error Handling

```typescript
import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    await page.goto('http://localhost:3000', {
      waitUntil: 'networkidle',
      timeout: 10000,
    });

    await page.screenshot({
      path: '/tmp/screenshot.png',
      fullPage: true,
    });

    console.log('📸 Screenshot saved to /tmp/screenshot.png');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
  }
})();
```

### Test Responsive Design

```typescript
// /tmp/playwright-test-responsive-full.ts
import { chromium } from 'playwright';

const TARGET_URL = 'http://localhost:3001'; // Auto-detected

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  const viewports = [
    { name: 'Desktop', width: 1920, height: 1080 },
    { name: 'Tablet', width: 768, height: 1024 },
    { name: 'Mobile', width: 375, height: 667 },
  ];

  for (const viewport of viewports) {
    console.log(
      `Testing ${viewport.name} (${viewport.width}x${viewport.height})`,
    );

    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });

    await page.goto(TARGET_URL);
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: `/tmp/${viewport.name.toLowerCase()}.png`,
      fullPage: true,
    });
  }

  console.log('✅ All viewports tested');
  await browser.close();
})();
```

## Inline Execution (Simple Tasks)

For quick one-off tasks, you can execute code inline without creating files:

```bash
# Take a quick screenshot
cd $SKILL_DIR && node run.ts "
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto('http://localhost:3001');
await page.screenshot({ path: '/tmp/quick-screenshot.png', fullPage: true });
console.log('Screenshot saved');
await browser.close();
"
```

**When to use inline vs files:**

- **Inline**: Quick one-off tasks (screenshot, check if element exists, get page title)
- **Files**: Complex tests, responsive design checks, anything user might want to re-run

## Available Helpers

Optional utility functions in `lib/helpers.ts`:

```typescript
import * as helpers from './lib/helpers.ts';

// Detect running dev servers (CRITICAL - use this first!)
const servers = await helpers.detectDevServers();
console.log('Found servers:', servers);

// Safe click with retry
await helpers.safeClick(page, 'button.submit', { retries: 3 });

// Safe type with clear
await helpers.safeType(page, '#username', 'testuser');

// Take timestamped screenshot
await helpers.takeScreenshot(page, 'test-result');

// Handle cookie banners
await helpers.handleCookieBanner(page);

// Extract table data
const data = await helpers.extractTableData(page, 'table.results');
```

See `lib/helpers.ts` for full list.

## Custom HTTP Headers

Configure custom headers for all HTTP requests via environment variables. Useful for:

- Identifying automated traffic to your backend
- Getting LLM-optimized responses (e.g., plain text errors instead of styled HTML)
- Adding authentication tokens globally

### Configuration

**Single header (common case):**

```bash
PW_HEADER_NAME=X-Automated-By PW_HEADER_VALUE=playwright-skill \
  cd $SKILL_DIR && node run.ts /tmp/my-script.ts
```

**Multiple headers (JSON format):**

```bash
PW_EXTRA_HEADERS='{"X-Automated-By":"playwright-skill","X-Debug":"true"}' \
  cd $SKILL_DIR && node run.ts /tmp/my-script.ts
```

### How It Works

Headers are automatically applied when using `helpers.createContext()`:

```javascript
const context = await helpers.createContext(browser);
const page = await context.newPage();
// All requests from this page include your custom headers
```

For scripts using raw Playwright API, use the injected `getContextOptionsWithHeaders()`:

```javascript
const context = await browser.newContext(
  getContextOptionsWithHeaders({ viewport: { width: 1920, height: 1080 } }),
);
```

## Advanced Usage

For comprehensive Playwright API documentation, see [API_REFERENCE.md](API_REFERENCE.md):

- Selectors & Locators best practices
- Network interception & API mocking
- Authentication & session management
- Visual regression testing
- Mobile device emulation
- Performance testing
- Debugging techniques
- CI/CD integration

## Tips

- **CRITICAL: Detect servers FIRST** - Always run `detectDevServers()` before writing test code for localhost testing
- **Custom headers** - Use `PW_HEADER_NAME`/`PW_HEADER_VALUE` env vars to identify automated traffic to your backend
- **Use /tmp for test files** - Write to `/tmp/playwright-test-*.ts`, never to skill directory or user's project
- **Parameterize URLs** - Put detected/provided URL in a `TARGET_URL` constant at the top of every script
- **DEFAULT: Visible browser** - Always use `headless: false` unless user explicitly asks for headless mode
- **Headless mode** - Only use `headless: true` when user specifically requests "headless" or "background" execution
- **Slow down:** Use `slowMo: 100` to make actions visible and easier to follow
- **Wait strategies:** Use `waitForURL`, `waitForSelector`, `waitForLoadState` instead of fixed timeouts
- **Error handling:** Always use try-catch for robust automation
- **Console output:** Use `console.log()` to track progress and show what's happening

## Troubleshooting

**Playwright not installed:**

```bash
cd $SKILL_DIR && npm run setup
```

**Module not found:**
Ensure running from skill directory via `run.ts` wrapper

**Browser doesn't open:**
Check `headless: false` and ensure display available

**Element not found:**
Add wait: `await page.waitForSelector('.element', { timeout: 10000 })`

## Example Usage

```
User: "Test if the marketing page looks good"

Claude: I'll test the marketing page across multiple viewports. Let me first detect running servers...
[Runs: detectDevServers()]
[Output: Found server on port 3001]
I found your dev server running on http://localhost:3001

[Writes custom automation script to /tmp/playwright-test-marketing.ts with URL parameterized]
[Runs: cd $SKILL_DIR && node run.ts /tmp/playwright-test-marketing.ts]
[Shows results with screenshots from /tmp/]
```

```
User: "Check if login redirects correctly"

Claude: I'll test the login flow. First, let me check for running servers...
[Runs: detectDevServers()]
[Output: Found servers on ports 3000 and 3001]
I found 2 dev servers. Which one should I test?
- http://localhost:3000
- http://localhost:3001

User: "Use 3001"

[Writes login automation to /tmp/playwright-test-login.ts]
[Runs: cd $SKILL_DIR && node run.ts /tmp/playwright-test-login.ts]
[Reports: ✅ Login successful, redirected to /dashboard]
```

## Notes

- Each automation is custom-written for your specific request
- Not limited to pre-built scripts - any browser task possible
- Auto-detects running dev servers to eliminate hardcoded URLs
- Test scripts written to `/tmp` for automatic cleanup (no clutter)
- Code executes reliably with proper module resolution via `run.ts`
- Progressive disclosure - API_REFERENCE.md loaded only when advanced features needed
