const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { log } = require("./config");
const { randomInt } = require("./humanBehavior");

chromium.use(StealthPlugin());

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
];

function launchBrowser() {
  return chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"]
  });
}

function makeRetryableError(message, originalError) {
  const error = new Error(message);
  error.retryable = true;
  error.originalError = originalError;
  return error;
}

function isLikelyTransient(error) {
  const msg = String(error?.message || "").toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("net::") ||
    msg.includes("econn") ||
    msg.includes("socket") ||
    msg.includes("browser has been closed") ||
    msg.includes("target page")
  );
}

function createStealthContext(browser, extraOptions = {}) {
  const viewport = { width: randomInt(1280, 1680), height: randomInt(720, 980) };
  const userAgent = USER_AGENTS[randomInt(0, USER_AGENTS.length - 1)];
  return browser.newContext({
    userAgent,
    viewport,
    locale: "en-US",
    timezoneId: "Asia/Kolkata",
    ...extraOptions
  });
}

function parseStorageStateFromEnv() {
  const raw = process.env.LEETCODE_STORAGE_STATE;
  if (!raw || !raw.trim()) {
    return { ok: false, reason: "session_missing" };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.cookies) || !Array.isArray(parsed.origins)) {
      return { ok: false, reason: "session_invalid" };
    }
    return { ok: true, storageState: parsed };
  } catch {
    return { ok: false, reason: "session_invalid_json" };
  }
}

async function isLoggedIn(page, context) {
  await page.goto("https://leetcode.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);

  await page.goto("https://leetcode.com/problemset/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);

  const redirectedToLogin = page.url().includes("/accounts/login");
  const signInVisible = (await page.locator('a[href*="/accounts/login"]').count()) > 0;
  const avatarVisible = (await page.locator('a[href*="/profile"], [data-e2e-locator="nav-user-avatar"]').count()) > 0;
  const cookies = await context.cookies();
  const hasSessionCookie = cookies.some((cookie) => cookie.name.toUpperCase().includes("LEETCODE_SESSION"));

  return !redirectedToLogin && hasSessionCookie && (avatarVisible || !signInVisible);
}

async function ensureAuthenticatedPage() {
  let browser;

  try {
    const storageStateResult = parseStorageStateFromEnv();
    if (!storageStateResult.ok) {
      log("WARN", "LeetCode session missing or invalid", { reason: storageStateResult.reason });
      return { ok: false, reason: storageStateResult.reason };
    }

    browser = await launchBrowser();
    const context = await createStealthContext(browser, { storageState: storageStateResult.storageState });
    const page = await context.newPage();

    const loggedIn = await isLoggedIn(page, context);
    if (!loggedIn) {
      log("WARN", "LeetCode session appears expired");
      await browser.close();
      return { ok: false, reason: "session_expired" };
    }

    return { ok: true, browser, context, page };
  } catch (error) {
    if (browser) {
      await browser.close();
    }

    log("ERROR", "Session initialization failed", { error: error.message });
    if (isLikelyTransient(error)) {
      throw makeRetryableError("Transient error while initializing session", error);
    }
    return { ok: false, reason: "session_init_failed", error: error.message };
  }
}

async function closeAuthenticatedResources(resources) {
  if (resources?.browser) {
    await resources.browser.close();
  }
}

async function ensureSessionReady() {
  const resources = await ensureAuthenticatedPage();
  if (!resources.ok) return resources;

  await closeAuthenticatedResources(resources);
  return { ok: true };
}

module.exports = {
  ensureAuthenticatedPage,
  closeAuthenticatedResources,
  ensureSessionReady,
  isLikelyTransient,
  makeRetryableError
};
