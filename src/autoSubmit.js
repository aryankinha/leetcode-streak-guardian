const { config, log } = require("./config");
const { actHuman, randomDelay, randomInt } = require("./humanBehavior");
const { notifyType } = require("./telegramNotifier");
const { detectCaptcha } = require("./captchaHandler");
const {
  ensureAuthenticatedPage,
  closeAuthenticatedResources,
  isLikelyTransient,
  makeRetryableError
} = require("./sessionManager");

const FALLBACK_PROBLEMS = [
  "https://leetcode.com/problems/two-sum/",
  "https://leetcode.com/problems/palindrome-number/",
  "https://leetcode.com/problems/valid-parentheses/"
];

function pickProblemUrl() {
  return FALLBACK_PROBLEMS[randomInt(0, FALLBACK_PROBLEMS.length - 1)];
}

async function waitForSubmissionSignal(page) {
  const responsePromise = page
    .waitForResponse(
      (response) => response.url().includes("/submit/") && response.request().method() === "POST",
      { timeout: 20000 }
    )
    .catch(() => null);

  const resultPromise = page
    .locator("text=/Accepted|Wrong Answer|Runtime Error|Compile Error|Time Limit Exceeded|Memory Limit Exceeded|Output Limit Exceeded/i")
    .first()
    .waitFor({ timeout: 25000 })
    .then(() => true)
    .catch(() => false);

  const [response, hasResult] = await Promise.all([responsePromise, resultPromise]);
  return Boolean(response) || hasResult;
}

async function tryAutoSubmit() {
  let resources;

  try {
    await notifyType(
      "AUTO_SUBMIT_ACTIVATED",
      "🚨 Emergency Streak Saver Activated\nA submission attempt is being made automatically to preserve your streak."
    );

    resources = await ensureAuthenticatedPage();
    if (!resources.ok) {
      return { ok: false, reason: resources.reason || "session_unavailable" };
    }

    const { page } = resources;

    const problemUrl = pickProblemUrl();
    await page.goto(problemUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await actHuman(page);

    if (await detectCaptcha(page, "auto-submit")) {
      return { ok: false, reason: "captcha_detected" };
    }

    const editorReady = await page
      .locator('[class*="monaco" i], [data-cy="code-area"], textarea')
      .first()
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false);

    if (!editorReady) {
      log("WARN", "Editor not detected before submit attempt");
    }

    const submitButton = page.locator('button:has-text("Submit"), [data-cy="submit-code-btn"]').first();
    const hasSubmit = await submitButton.count();

    if (hasSubmit === 0) {
      log("WARN", "Submit button not found on problem page");
      return { ok: false, reason: "submit_button_not_found" };
    }

    await submitButton.waitFor({ timeout: 15000 });
    await randomDelay(page, 1000, 2500);
    await submitButton.click({ timeout: 15000 });

    const submissionDetected = await waitForSubmissionSignal(page);
    if (!submissionDetected) {
      log("WARN", "Submit was clicked but no submission signal detected");
      return { ok: false, reason: "submission_not_detected" };
    }

    log("INFO", "Auto-submit attempt completed", { problemUrl });
    await notifyType("INFO", "Auto-submit attempt completed and submission signal was detected.");
    return { ok: true, submissionDetected: true };
  } catch (error) {
    log("ERROR", "Auto-submit failed", { error: error.message });
    await notifyType("ERROR", `Auto-submit failed: ${error.message}`);
    if (isLikelyTransient(error)) {
      throw makeRetryableError("Transient error during auto-submit", error);
    }
    return { ok: false, reason: "auto_submit_error", error: error.message };
  } finally {
    await closeAuthenticatedResources(resources);
  }
}

module.exports = {
  tryAutoSubmit
};
