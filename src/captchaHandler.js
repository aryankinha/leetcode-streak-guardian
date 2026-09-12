const { sendMessage } = require('./telegramNotifier');

/**
 * Basic CAPTCHA detection and handling
 */
async function detectCaptcha(page) {
  const captchaSelectors = [
    '.g-recaptcha',
    'iframe[title*="recaptcha"]',
    '#h-captcha',
    'iframe[src*="hcaptcha"]',
    '#cf-turnstile',
  ];

  for (const selector of captchaSelectors) {
    try {
      if (await page.locator(selector).first().isVisible({ timeout: 1000 })) {
        console.log(`CAPTCHA detected: ${selector}`);
        return true;
      }
    } catch (e) {
      // Ignore
    }
  }

  return false;
}

async function handleCaptcha(page) {
  const detected = await detectCaptcha(page);
  if (detected) {
    await sendMessage('🚨 CAPTCHA detected on LeetCode! Manual intervention is required to proceed.');
    return true;
  }
  return false;
}

module.exports = { detectCaptcha, handleCaptcha };
