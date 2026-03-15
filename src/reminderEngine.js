const fs = require("fs");
const { config, log } = require("./config");
const { notifyType } = require("./telegramNotifier");
const { getCurrentLeetCodeDayKey } = require("./leetcodeApi");

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const TEST_MODE = process.env.TEST_MODE === "true";

function buildDefaultState() {
  return {
    dayKey: getCurrentLeetCodeDayKey(),
    lastReminderAt: null,
    lastAutoSubmitAt: null,
    lastReminderStage: null,
    lastCheckAt: null,
    lastRunId: null
  };
}

function readState() {
  try {
    const raw = fs.readFileSync(config.paths.STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeStateForDay({ ...buildDefaultState(), ...parsed });
  } catch {
    return buildDefaultState();
  }
}

function writeState(nextState) {
  fs.writeFileSync(config.paths.STATE_PATH, JSON.stringify(nextState, null, 2));
}

function normalizeStateForDay(state) {
  const currentDayKey = getCurrentLeetCodeDayKey();
  if (state.dayKey === currentDayKey) {
    return state;
  }

  const resetState = {
    ...state,
    dayKey: currentDayKey,
    lastReminderAt: null,
    lastAutoSubmitAt: null,
    lastReminderStage: null
  };

  writeState(resetState);
  return resetState;
}

function nowIst() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

function getMinutesSinceMidnightIst(date = nowIst()) {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function getReminderStage(minutes) {
  // TEST MODE OVERRIDE
  if (TEST_MODE) {
    return { stage: "emergency", interval: 0 };
  }

  const m = minutes;
  const eightPm = 20 * 60;
  const tenPm = 22 * 60;
  const oneAm = 60;
  const twoAm = 120;
  const reset = 330;

  if (m >= eightPm && m < tenPm) return { stage: "hourly", interval: 60 };
  if ((m >= tenPm && m < 24 * 60) || (m >= 0 && m < oneAm)) return { stage: "every30", interval: 30 };
  if (m >= oneAm && m < twoAm) return { stage: "every5", interval: 5 };
  if (m >= twoAm && m < reset) return { stage: "emergency", interval: 5 };

  return { stage: "quiet", interval: null };
}

function shouldSendReminder(currentStage, state, now = new Date()) {
  if (currentStage.stage === "quiet") return false;
  if (!state.lastReminderAt) return true;

  const minutesSince = (now.getTime() - new Date(state.lastReminderAt).getTime()) / 60000;
  if (!currentStage.interval) return false;
  return minutesSince >= currentStage.interval;
}

function formatIstTime(date = nowIst()) {
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} IST`;
}

async function runReminderEscalation() {
  const state = readState();
  const now = new Date();
  const stage = getReminderStage(getMinutesSinceMidnightIst());
  const dayKey = getCurrentLeetCodeDayKey();

  // TEST MODE OVERRIDE
  if (TEST_MODE) {
    console.log("[DEBUG] UTC time:", now.toISOString());
    console.log("[DEBUG] IST time:", now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }));
    console.log("[DEBUG] DayKey:", dayKey);
    console.log("[DEBUG] Reminder state:", JSON.stringify({
      lastReminderAt: state.lastReminderAt,
      lastAutoSubmitAt: state.lastAutoSubmitAt,
      lastReminderStage: state.lastReminderStage
    }));
    console.log("[DEBUG] Emergency window active:", stage.stage === "emergency");
  }

  if (!shouldSendReminder(stage, state, now)) {
    return { state, stage, shouldAutoSubmit: stage.stage === "emergency" };
  }

  let message = `⚠️ You haven't submitted a LeetCode problem today.\nYour streak may break.\nCurrent time: ${formatIstTime()}.`;
  let type = "INFO";

  if (stage.stage === "every5" || stage.stage === "emergency") {
    type = "WARNING";
    message = `🚨 Streak risk is critical.\nCurrent time: ${formatIstTime()}\nPlease submit immediately.`;
  }

  await notifyType(type, message);
  state.lastReminderAt = now.toISOString();
  state.lastReminderStage = stage.stage;
  writeState(state);
  log("INFO", "triggering reminder", { stage: stage.stage });

  return { state, stage, shouldAutoSubmit: stage.stage === "emergency" };
}

function markAutoSubmit(runId) {
  const state = readState();
  state.lastAutoSubmitAt = new Date().toISOString();
  state.lastRunId = runId || state.lastRunId;
  writeState(state);
}

function shouldRetryAutoSubmit() {
  const state = readState();
  if (!state.lastAutoSubmitAt) return true;
  const minutes = (Date.now() - new Date(state.lastAutoSubmitAt).getTime()) / 60000;
  return minutes >= config.autoSubmitRetryMinutes;
}

function markCheckNow(runId) {
  const state = readState();
  state.lastCheckAt = new Date().toISOString();
  state.lastRunId = runId || state.lastRunId;
  writeState(state);
}

module.exports = {
  runReminderEscalation,
  markAutoSubmit,
  shouldRetryAutoSubmit,
  markCheckNow,
  readState,
  writeState,
  getReminderStage,
  getMinutesSinceMidnightIst
};
