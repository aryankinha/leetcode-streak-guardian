const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { log } = require("./config");
const { fetchRecentSubmissions, getLatestSubmittedProblemSlug } = require("./leetcodeApi");

chromium.use(StealthPlugin());

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PLAYWRIGHT_DEBUG_MODE = process.env.PLAYWRIGHT_DEBUG_MODE === "true";

function debugLog(...args) {
  if (PLAYWRIGHT_DEBUG_MODE) {
    console.log(...args);
  }
}

async function logPageState(page) {
  if (!PLAYWRIGHT_DEBUG_MODE) {
    return;
  }
  console.log("[PW] Current URL:", page.url());
  console.log("[PW] Page title:", await page.title());
}

async function captureDebugArtifacts(page, screenshotName, dumpHtml = false) {
  if (!PLAYWRIGHT_DEBUG_MODE || !page) {
    return;
  }

  await page.screenshot({ path: path.join("/tmp", screenshotName) }).catch(() => null);
  if (dumpHtml) {
    fs.writeFileSync("/tmp/pw_failure.html", await page.content(), "utf8");
  }
}

function getStorageStateFromEnv() {
  const raw = process.env.LEETCODE_STORAGE_STATE;
  if (!raw || !raw.trim()) {
    return { ok: false, reason: "session_missing" };
  }

  try {
    debugLog("[PW] storage state length:", raw.length);
    const parsed = JSON.parse(raw);
    debugLog("[PW] parsed cookies count:", parsed.cookies?.length || 0);
    if (!parsed || !Array.isArray(parsed.cookies) || !Array.isArray(parsed.origins)) {
      return { ok: false, reason: "session_invalid" };
    }

    const hasLeetCodeCookies = parsed.cookies.some((cookie) =>
      typeof cookie?.domain === "string" && cookie.domain.includes(".leetcode.com")
    );

    if (!hasLeetCodeCookies) {
      log("WARN", "Storage state does not contain .leetcode.com cookies");
      return { ok: false, reason: "session_invalid" };
    }

    return { ok: true, storageState: parsed };
  } catch {
    return { ok: false, reason: "session_invalid" };
  }
}

function createBrowser() {
  return chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"]
  });
}

async function createAuthenticatedResources() {
  const session = getStorageStateFromEnv();
  if (!session.ok) {
    return { ok: false, reason: session.reason };
  }

  const storageStatePath = path.join(os.tmpdir(), `leetcode-state-${process.pid}.json`);
  fs.writeFileSync(storageStatePath, JSON.stringify(session.storageState), "utf8");

  const browser = await createBrowser();
  const context = await browser.newContext({
    storageState: storageStatePath,
    userAgent: USER_AGENT,
    viewport: { width: 1366, height: 768 },
    locale: "en-US",
    timezoneId: "Asia/Kolkata"
  });
  const page = await context.newPage();

  if (PLAYWRIGHT_DEBUG_MODE) {
    page.on("console", (msg) => console.log("[PW PAGE]", msg.text()));
    page.on("request", (req) => console.log("[PW REQUEST]", req.method(), req.url()));
    page.on("response", (res) => console.log("[PW RESPONSE]", res.status(), res.url()));
    page.on("pageerror", (err) => console.log("[PW ERROR]", err?.stack || err?.message || String(err)));
  }

  return { ok: true, browser, context, page, storageStatePath };
}

async function closeResources(resources) {
  if (resources?.browser) {
    await resources.browser.close();
  }
  if (resources?.storageStatePath) {
    fs.rmSync(resources.storageStatePath, { force: true });
  }
}

async function isSessionValid(page, context) {
  debugLog("[PW] Navigating to:", "https://leetcode.com/");
  await page.goto("https://leetcode.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(8000);
  await logPageState(page);

  debugLog("[PW] Navigating to:", "https://leetcode.com/problemset/");
  await page.goto("https://leetcode.com/problemset/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(8000);
  await logPageState(page);

  const loginButton = await page.locator('a[href="/accounts/login/"]').count();
  const avatarCount = await page.locator('[data-e2e-locator="navbar-user-profile"]').count();
  const cookies = await context.cookies();
  const hasSessionCookie = cookies.some((cookie) => cookie.name.toUpperCase().includes("LEETCODE_SESSION"));
  debugLog("[PW] login button count:", loginButton);
  debugLog("[PW] avatar count:", avatarCount);

  return hasSessionCookie && loginButton === 0;
}

async function waitHumanDelay(page) {
  await page.waitForTimeout(2000 + Math.random() * 2000);
}

async function resolveProblemUrl(username) {
  try {
    const submissions = await fetchRecentSubmissions(username);
    const slug = getLatestSubmittedProblemSlug(submissions);
    return `https://leetcode.com/problems/${slug}/`;
  } catch (error) {
    log("WARN", "Failed to fetch recent submissions for problem selection; using fallback", { error: error.message });
    return "https://leetcode.com/problems/two-sum/";
  }
}

async function waitForEditor(page) {
  const editorLocator = page.locator('.monaco-editor, [data-cy="code-area"], textarea').first();
  const editorDetected = await editorLocator
    .waitFor({ state: "visible", timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  debugLog("[PW] editor detected:", editorDetected ? 1 : 0);
  if (editorDetected) {
    await captureDebugArtifacts(page, "pw_step_editor_loaded.png");
  }
  return editorDetected;
}

async function findSubmitButton(page) {
  const selectors = [
    '[data-e2e-locator="console-submit-button"]',
    '[data-cy="submit-code-btn"]',
    'button:has-text("Submit")',
    'button:has-text("Submit Code")'
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    debugLog("[PW] submit button count:", count, "selector:", selector);
    const visible = await locator.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
    if (!visible) {
      continue;
    }

    const enabled = await locator.isEnabled().catch(() => false);
    if (!enabled) {
      continue;
    }

    return locator;
  }

  return null;
}

async function waitForSubmissionSignal(page) {
  const responsePromise = page
    .waitForResponse(
      (response) => {
        const matches = response.url().includes("/submit/") && response.request().method() === "POST";
        if (matches) {
          debugLog("[PW] Detected submit POST:", response.url());
        }
        return matches;
      },
      { timeout: 30000 }
    )
    .catch(() => null);

  const resultPromise = page
    .locator("text=/Accepted|Wrong Answer|Runtime Error|Compile Error|Time Limit Exceeded|Memory Limit Exceeded|Output Limit Exceeded/i")
    .first()
    .waitFor({ timeout: 30000 })
    .then(() => true)
    .catch(() => false);

  const [response, hasResult] = await Promise.all([responsePromise, resultPromise]);
  return Boolean(response) || hasResult;
}

async function tryPlaywrightSubmit(username) {
  let resources;

  try {
    log("INFO", "launching playwright");

    resources = await createAuthenticatedResources();
    if (!resources.ok) {
      return { ok: false, reason: resources.reason };
    }

    const { page, context } = resources;
    const sessionValid = await isSessionValid(page, context);
    if (!sessionValid) {
      log("WARN", "session expired");
      return { ok: false, reason: "session_expired" };
    }

    const problemUrl = await resolveProblemUrl(username);
    debugLog("[PW] Navigating to:", problemUrl);
    await page.goto(problemUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(8000);
    await logPageState(page);
    await captureDebugArtifacts(page, "pw_step_problem_page.png");

    const loginButton = await page.locator('a[href="/accounts/login/"]').count();
    const avatarCount = await page.locator('[data-e2e-locator="navbar-user-profile"]').count();
    debugLog("[PW] login button count:", loginButton);
    debugLog("[PW] avatar count:", avatarCount);
    if (loginButton > 0) {
      debugLog("[PW] Redirect detected:", page.url());
      await captureDebugArtifacts(page, "pw_failure_session_expired.png", true);
      log("WARN", "session expired");
      return { ok: false, reason: "session_expired" };
    }

    const editorReady = await waitForEditor(page);
    if (!editorReady) {
      await captureDebugArtifacts(page, "pw_failure_missing_editor.png", true);
      return { ok: false, reason: "playwright_submit_failed" };
    }

    const submitButton = await findSubmitButton(page);
    if (!submitButton) {
      await captureDebugArtifacts(page, "pw_failure_missing_submit_button.png", true);
      return { ok: false, reason: "submit_button_not_found" };
    }

    await submitButton.scrollIntoViewIfNeeded();
    await waitHumanDelay(page);

    const enabledBeforeClick = await submitButton.isEnabled().catch(() => false);
    if (!enabledBeforeClick) {
      await captureDebugArtifacts(page, "pw_failure_disabled_submit_button.png", true);
      return { ok: false, reason: "submit_button_not_found" };
    }

    debugLog("[PW] Clicking submit button");
    await submitButton.click({ timeout: 15000 });

    debugLog("[PW] Waiting for submission response");
    const submissionDetected = await waitForSubmissionSignal(page);
    if (!submissionDetected) {
      await captureDebugArtifacts(page, "pw_failure_submission_not_detected.png", true);
      return { ok: false, reason: "submission_not_detected" };
    }

    return { ok: true, problemUrl };
  } catch (error) {
    log("ERROR", "Playwright submit failed", { error: error.message });
    return { ok: false, reason: "playwright_submit_failed", error: error.message };
  } finally {
    await closeResources(resources);
  }
}

module.exports = {
  getStorageStateFromEnv,
  tryPlaywrightSubmit
};
