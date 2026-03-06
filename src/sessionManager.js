const fs = require("fs");
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { config, log } = require("./config");
const { actHuman, humanType, randomDelay, randomInt } = require("./humanBehavior");
const { detectCaptcha } = require("./captchaHandler");
const { notifyType } = require("./telegramNotifier");

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

function hasValidSessionFile() {
  try {
    if (!fs.existsSync(config.paths.SESSION_PATH)) return false;
    const raw = fs.readFileSync(config.paths.SESSION_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return Array.isArray(parsed.cookies) && Array.isArray(parsed.origins);
  } catch {
    return false;
  }
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

async function performLogin(page, context) {
  log("INFO", "performing login");
  await notifyType("LOGIN_REQUIRED", "Session expired. Attempting automated login refresh.");

  await page.goto(config.leetcode.loginUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await actHuman(page);

  if (await detectCaptcha(page, "login page")) {
    return { ok: false, reason: "captcha_detected" };
  }

  const emailInput = page.locator('input[name="login"], input#id_login, input[type="email"]').first();
  const passwordInput = page.locator('input[name="password"], input#id_password, input[type="password"]').first();
  const loginButton = page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Log In")').first();

  await emailInput.waitFor({ timeout: 12000 });
  await emailInput.click({ timeout: 10000 });
  await humanType(emailInput, config.leetcode.email);
  await randomDelay(page, 400, 1300);

  await passwordInput.waitFor({ timeout: 12000 });
  await passwordInput.click({ timeout: 10000 });
  await humanType(passwordInput, config.leetcode.password);
  await randomDelay(page, 900, 2000);

  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout: 60000 }),
    loginButton.click({ timeout: 10000 })
  ]);
  await page.waitForTimeout(2500);

  if (await detectCaptcha(page, "post-login")) {
    return { ok: false, reason: "captcha_detected" };
  }

  const loggedIn = await isLoggedIn(page, context);
  if (!loggedIn) {
    await notifyType("LOGIN_REQUIRED", "Login refresh failed. Please verify credentials or complete login manually.");
    return { ok: false, reason: "login_failed" };
  }

  await context.storageState({ path: config.paths.SESSION_PATH });
  log("INFO", "Session refreshed and saved", { sessionPath: config.paths.SESSION_PATH });
  return { ok: true };
}

async function ensureAuthenticatedPage() {
  let browser;

  try {
    browser = await launchBrowser();
    const contextOptions = hasValidSessionFile() ? { storageState: config.paths.SESSION_PATH } : {};
    const context = await createStealthContext(browser, contextOptions);
    const page = await context.newPage();

    const loggedIn = await isLoggedIn(page, context);
    if (loggedIn) {
      return { ok: true, browser, context, page, refreshed: false };
    }

    log("WARN", "session expired or missing");
    await notifyType("SESSION_EXPIRED", "Session expired or missing. Starting login refresh.");

    const loginResult = await performLogin(page, context);
    if (!loginResult.ok) {
      await browser.close();
      return { ok: false, reason: loginResult.reason };
    }

    return { ok: true, browser, context, page, refreshed: true };
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
  return { ok: true, refreshed: resources.refreshed };
}

module.exports = {
  ensureAuthenticatedPage,
  closeAuthenticatedResources,
  ensureSessionReady,
  isLikelyTransient,
  makeRetryableError
};
