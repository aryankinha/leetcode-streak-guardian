const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const ROOT_DIR = path.resolve(__dirname, "..");
const LOGS_DIR = path.resolve(ROOT_DIR, "logs");
const RUNTIME_DIR = path.resolve(ROOT_DIR, "runtime");
const SESSION_PATH = path.resolve(RUNTIME_DIR, "session.json");
const STATE_PATH = path.resolve(LOGS_DIR, "runtimeState.json");
const LOCK_FILE_PATH = path.resolve(LOGS_DIR, "guardian.lock");
const LOG_FILE_PATH = path.resolve(LOGS_DIR, `guardian-${new Date().toISOString().slice(0, 10)}.log`);

for (const dir of [LOGS_DIR, RUNTIME_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function toPositiveNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const config = {
  appName: "leetcode-streak-guardian",
  checkIntervalMinutes: toPositiveNumber(process.env.CHECK_INTERVAL, 10),
  useInternalCron: String(process.env.USE_INTERNAL_CRON || "false").toLowerCase() === "true",
  autoSubmitRetryMinutes: toPositiveNumber(process.env.AUTO_SUBMIT_RETRY_MINUTES, 15),
  lockStaleMinutes: toPositiveNumber(process.env.LOCK_STALE_MINUTES, 25),
  leetcode: {
    username: process.env.LEETCODE_USERNAME,
    email: process.env.LEETCODE_EMAIL,
    password: process.env.LEETCODE_PASSWORD,
    graphqlUrl: "https://leetcode.com/graphql",
    loginUrl: "https://leetcode.com/accounts/login/"
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID
  },
  paths: {
    ROOT_DIR,
    LOGS_DIR,
    RUNTIME_DIR,
    SESSION_PATH,
    STATE_PATH,
    LOCK_FILE_PATH,
    LOG_FILE_PATH
  }
};

function log(level, message, meta = null) {
  const time = new Date().toISOString();
  const line = `[${level}] ${time} ${message}${meta ? ` ${JSON.stringify(meta)}` : ""}`;
  console.log(line);
  try {
    fs.appendFileSync(config.paths.LOG_FILE_PATH, `${line}\n`, "utf8");
  } catch (error) {
    console.error(`[WARN] ${time} Failed to write log file: ${error.message}`);
  }
}

function validateConfig() {
  const fatalErrors = [];
  const warnings = [];

  if (!config.leetcode.username) {
    fatalErrors.push("LEETCODE_USERNAME is required");
  }

  if (!config.telegram.botToken || !config.telegram.chatId) {
    fatalErrors.push("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required");
  }

  if (!config.leetcode.email || !config.leetcode.password) {
    fatalErrors.push("LEETCODE_EMAIL and LEETCODE_PASSWORD are required for self-healing session login");
  }

  return { fatalErrors, warnings };
}

module.exports = {
  config,
  log,
  validateConfig
};
