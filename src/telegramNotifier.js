const axios = require("axios");
const { config, log } = require("./config");

async function sendTelegram(message) {
  if (!config.telegram.botToken || !config.telegram.chatId) {
    log("WARN", "Telegram not configured; skipping notification");
    return false;
  }

  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await axios.post(
        url,
        {
          chat_id: config.telegram.chatId,
          text: message
        },
        {
          timeout: 15000
        }
      );
      log("INFO", "Telegram notification sent", { attempt });
      return true;
    } catch (error) {
      log("ERROR", "Failed to send Telegram notification", { attempt, error: error.message });
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  return false;
}

async function notifyType(type, message) {
  const prefixes = {
    INFO: "[INFO]",
    WARNING: "[WARNING]",
    AUTO_SUBMIT_ACTIVATED: "[AUTO SUBMIT ACTIVATED]",
    SESSION_EXPIRED: "[SESSION EXPIRED]",
    LOGIN_REQUIRED: "[LOGIN REQUIRED]",
    CAPTCHA_DETECTED: "[CAPTCHA DETECTED]",
    ERROR: "[ERROR]"
  };

  const prefix = prefixes[type] || "[NOTICE]";
  return sendTelegram(`${prefix}\n${message}`);
}

module.exports = {
  sendTelegram,
  notifyType
};
