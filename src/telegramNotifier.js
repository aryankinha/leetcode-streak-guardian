const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');

const bot = new TelegramBot(config.telegram.token, { polling: false });

async function sendMessage(text) {
  const token = config.telegram.token?.trim();
  const chatId = config.telegram.chatId?.trim();
  const placeholders = ['your_bot_token', 'your_chat_id', ''];

  if (!token || !chatId || placeholders.includes(token.toLowerCase()) || placeholders.includes(chatId.toLowerCase())) {
    console.warn('[WARN] Telegram token or chatId not configured in .env. Skipping message.');
    return;
  }

  try {
    await bot.sendMessage(config.telegram.chatId, text);
    console.log(`Telegram message sent: ${text}`);
  } catch (error) {
    console.error(`Error sending Telegram message: ${error.message}`);
  }
}

module.exports = { sendMessage };
