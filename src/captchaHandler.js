const { notifyType } = require("./telegramNotifier");
const { log } = require("./config");

const CAPTCHA_SELECTORS = [
  'iframe[title*="captcha" i]',
  '[id*="captcha" i]',
  '[class*="captcha" i]',
  'iframe[src*="recaptcha"]',
  "div.g-recaptcha"
];

async function detectCaptcha(page, contextLabel = "automation flow") {
  try {
    for (const selector of CAPTCHA_SELECTORS) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        log("WARN", "captcha detected", { selector, contextLabel });
        await notifyType("CAPTCHA_DETECTED", `⚠️ CAPTCHA detected during ${contextLabel}. Manual intervention required.`);
        return true;
      }
    }
    return false;
  } catch (error) {
    log("ERROR", "CAPTCHA detection failed", { error: error.message });
    return false;
  }
}

module.exports = {
  detectCaptcha
};
