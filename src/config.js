require('dotenv').config({ quiet: true });
const path = require('path');
const fs = require('fs');

const rootDir = path.join(__dirname, '..');
const runtimeDir = path.join(rootDir, 'runtime');
const logsDir = path.join(rootDir, 'logs');

// Ensure runtime and logs directories exist on boot.
for (const dir of [runtimeDir, logsDir]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function parseCheckInterval(value) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 10;
  return Math.min(parsed, 59);
}

module.exports = {
  leetcode: {
    username: process.env.LEETCODE_USERNAME,
    graphqlUrl: 'https://leetcode.com/graphql',
    // Optional. Needed to verify per-problem status (solved / attempted /
    // never attempted). Without it, recommendations are marked unverified.
    session: process.env.LEETCODE_SESSION,
    csrfToken: process.env.LEETCODE_CSRFTOKEN,
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },
  checkInterval: parseCheckInterval(process.env.CHECK_INTERVAL),
  paths: {
    runtimeDir,
    logsDir,
    runtimeState: path.join(runtimeDir, 'state.json'),
    runtimeRecommendation: path.join(runtimeDir, 'recommendation.json'),
    logs: path.join(logsDir, 'app.log'),
  },
};
