const axios = require('axios');
const config = require('./config');
const { log } = require('./logger');

const TOKEN_PLACEHOLDERS = new Set(['your_bot_token', 'your_telegram_bot_token', '']);
const CHAT_PLACEHOLDERS = new Set(['your_chat_id', 'your_telegram_chat_id', '']);

function getCredentials() {
  const token = config.telegram.token?.trim() || '';
  const chatId = config.telegram.chatId?.trim() || '';

  if (
    !token ||
    !chatId ||
    TOKEN_PLACEHOLDERS.has(token.toLowerCase()) ||
    CHAT_PLACEHOLDERS.has(chatId.toLowerCase())
  ) {
    return null;
  }

  return { token, chatId };
}

/**
 * Sends a plain-text Telegram message with retries.
 * Returns true only when Telegram accepted the message.
 */
async function sendMessage(text) {
  const credentials = getCredentials();
  if (!credentials) {
    log('[WARN] Telegram is not configured. Skipping message.');
    return false;
  }

  const url = `https://api.telegram.org/bot${credentials.token}/sendMessage`;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await axios.post(
        url,
        {
          chat_id: credentials.chatId,
          text,
          disable_web_page_preview: true,
        },
        { timeout: 15000 }
      );

      if (response.data?.ok) {
        log('[INFO] Telegram message sent.');
        return true;
      }

      log(`[WARN] Telegram rejected the message: ${response.data?.description || 'unknown error'}`);
      return false;
    } catch (error) {
      const status = error.response?.status;
      const description = error.response?.data?.description || error.message;
      const retryAfter = error.response?.data?.parameters?.retry_after;

      log(`[WARN] Telegram send failed (attempt ${attempt}/3): ${description}`);

      // Invalid token, blocked bot, bad chat id: retrying will not help.
      if (status && status >= 400 && status < 500 && status !== 429) {
        return false;
      }

      if (attempt < 3) {
        const waitMs = retryAfter ? retryAfter * 1000 : attempt * 1000;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  return false;
}

module.exports = { sendMessage };
