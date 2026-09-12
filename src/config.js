require('dotenv').config();
const path = require('path');
const fs = require('fs');

const rootDir = path.join(__dirname, '..');
const runtimeDir = path.join(rootDir, 'runtime');
const logsDir = path.join(rootDir, 'logs');

// Ensure runtime and logs directories exist on boot
if (!fs.existsSync(runtimeDir)) {
  fs.mkdirSync(runtimeDir, { recursive: true });
}
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

module.exports = {
  leetcode: {
    username: process.env.LEETCODE_USERNAME,
    email: process.env.LEETCODE_EMAIL,
    password: process.env.LEETCODE_PASSWORD,
    session: process.env.LEETCODE_SESSION,
    csrfToken: process.env.LEETCODE_CSRF_TOKEN || process.env.LEETCODE_CSRFTOKEN,
    graphqlUrl: 'https://leetcode.com/graphql',
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },
  checkInterval: parseInt(process.env.CHECK_INTERVAL || '10', 10),
  paths: {
    runtimeDir,
    logsDir,
    session: path.join(runtimeDir, 'session.json'),
    sessionMeta: path.join(runtimeDir, 'session-meta.json'),
    submissionHistory: path.join(runtimeDir, 'submission-history.json'),
    runtimeState: path.join(runtimeDir, 'state.json'),
    logs: path.join(logsDir, 'app.log'),
  },
};
