const fs = require('fs');
const config = require('./config');
const { sendMessage } = require('./telegramNotifier');
const { getDailyCodingChallenge } = require('./leetcodeApi');
const { LEETCODE_RESET_MINUTES_IST } = require('./constants');
const { log } = require('./logger');

const IST_TIME_ZONE = 'Asia/Kolkata';

const WINDOW = {
  QUIET: 'quiet',
  DAYTIME: 'daytime',
  EVENING: 'evening',
  LATE_EVENING: 'late-evening',
  URGENT: 'urgent',
  CRITICAL: 'critical',
};

const istFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: IST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * Parses a date into IST parts. hourCycle h23 guarantees 00 at midnight.
 */
function getISTParts(date = new Date()) {
  const parts = Object.fromEntries(
    istFormatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  const hour = parseInt(parts.hour, 10);
  const minute = parseInt(parts.minute, 10);

  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour,
    minute,
    istDateStr: `${parts.year}-${parts.month}-${parts.day}`,
    totalMinutesFromMidnight: hour * 60 + minute,
  };
}

/**
 * The LeetCode streak day is the UTC date because LeetCode resets at 00:00 UTC.
 */
function getLeetCodeStreakDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function getReminderWindow(totalMinutes) {
  if (totalMinutes >= 9 * 60 + 30 && totalMinutes < 17 * 60 + 30) return WINDOW.DAYTIME;
  if (totalMinutes >= 18 * 60 && totalMinutes < 20 * 60) return WINDOW.EVENING;
  if (totalMinutes >= 20 * 60 && totalMinutes < 22 * 60) return WINDOW.LATE_EVENING;
  if (totalMinutes >= 22 * 60 || totalMinutes < 60) return WINDOW.URGENT;
  if (totalMinutes >= 60 && totalMinutes < LEETCODE_RESET_MINUTES_IST) return WINDOW.CRITICAL;
  return WINDOW.QUIET;
}

function getReminderIntervalMinutes(window) {
  switch (window) {
    case WINDOW.DAYTIME:
      return 60;
    case WINDOW.LATE_EVENING:
      return 30;
    case WINDOW.URGENT:
      return 15;
    case WINDOW.CRITICAL:
      return 10;
    default:
      return null;
  }
}

function getMinutesUntilReset(ist) {
  const now = ist.totalMinutesFromMidnight;
  return now < LEETCODE_RESET_MINUTES_IST
    ? LEETCODE_RESET_MINUTES_IST - now
    : 24 * 60 - now + LEETCODE_RESET_MINUTES_IST;
}

function formatDuration(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

function formatIstTime(ist) {
  const hour12 = ist.hour % 12 || 12;
  const suffix = ist.hour < 12 ? 'AM' : 'PM';
  return `${hour12}:${String(ist.minute).padStart(2, '0')} ${suffix} IST`;
}

function buildReminderMessage({ window, ist, dcc = null }) {
  const time = formatIstTime(ist);
  const resetIn = formatDuration(getMinutesUntilReset(ist));

  if (window === WINDOW.DAYTIME) {
    return [
      "📌 Today's LeetCode streak is pending",
      'No accepted submission today.',
      `Time: ${time} | Reset in ${resetIn}`,
    ].join('\n');
  }

  if (window === WINDOW.EVENING) {
    const lines = [
      "📌 Today's LeetCode streak is pending",
      'No accepted submission today.',
      `Time: ${time} | Reset: 5:30 AM IST (in ${resetIn})`,
    ];

    if (dcc?.title) {
      lines.push(`Challenge: ${dcc.title} (${dcc.difficulty})`);
      lines.push(dcc.link);
    }

    return lines.join('\n');
  }

  if (window === WINDOW.LATE_EVENING) {
    return [
      "⏰ Today's LeetCode streak is still pending",
      'No accepted submission today.',
      `Time: ${time} | Reset in ${resetIn}`,
    ].join('\n');
  }

  if (window === WINDOW.URGENT) {
    return [
      '⚠️ LeetCode streak expires soon',
      'No accepted submission today.',
      `Time: ${time} | Reset in ${resetIn}`,
      'Solve any problem before 5:30 AM IST.',
    ].join('\n');
  }

  return [
    '🚨 Final hours: LeetCode streak is pending',
    'No accepted submission today.',
    `Time: ${time} | Reset in ${resetIn}`,
    'Solve any problem before 5:30 AM IST.',
  ].join('\n');
}

function buildDefaultState(streakDay) {
  return {
    streakDay,
    firstReminderSentDay: null,
    lastAlertTime: 0,
    pendingAlertDay: null,
    safeNotifiedDay: null,
    lastErrorAlertTime: 0,
  };
}

/**
 * Loads reminder state and resets it when the LeetCode streak day changes.
 */
function loadState(now = new Date()) {
  const filePath = config.paths.runtimeState;
  const currentStreakDay = getLeetCodeStreakDay(now);
  const defaultState = buildDefaultState(currentStreakDay);

  if (!fs.existsSync(filePath)) {
    saveState(defaultState);
    return defaultState;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const state = { ...defaultState, ...parsed };

    // Older versions stored auto-submit fields. They are no longer used.
    delete state.autoSubmit;
    delete state.autoSubmitJitterMinutes;

    state.lastAlertTime = Number(state.lastAlertTime) || 0;
    state.lastErrorAlertTime = Number(state.lastErrorAlertTime) || 0;

    // A future timestamp (clock skew or a bad state file) would suppress
    // every reminder until that time passes. Treat it as unset.
    const nowMs = now.getTime();
    if (state.lastAlertTime > nowMs) state.lastAlertTime = 0;
    if (state.lastErrorAlertTime > nowMs) state.lastErrorAlertTime = 0;

    if (state.streakDay !== currentStreakDay) {
      log(`[INFO] New streak day: ${currentStreakDay} (was ${state.streakDay}). Resetting reminder state.`);
      const reset = buildDefaultState(currentStreakDay);
      saveState(reset);
      return reset;
    }

    return state;
  } catch (error) {
    log(`[WARN] Could not read reminder state; starting fresh: ${error.message}`);
    saveState(defaultState);
    return defaultState;
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(config.paths.runtimeState, JSON.stringify(state, null, 2), 'utf-8');
  } catch (error) {
    log(`[ERROR] Could not save reminder state: ${error.message}`);
  }
}

/**
 * Sends at most one reminder per configured interval, only inside the
 * 9:30 AM to 5:30 AM IST window. State is advanced only after Telegram
 * accepts the message, so a failed send is retried on the next run.
 */
async function processReminders({
  now = new Date(),
  send = sendMessage,
  fetchDcc = getDailyCodingChallenge,
} = {}) {
  const ist = getISTParts(now);
  const streakDay = getLeetCodeStreakDay(now);
  const state = loadState(now);
  const window = getReminderWindow(ist.totalMinutesFromMidnight);

  if (window === WINDOW.QUIET) {
    log(`[INFO] Quiet hours (${formatIstTime(ist)}). No reminder.`);
    return { sent: false, window };
  }

  const intervalMinutes = getReminderIntervalMinutes(window);
  const shouldSend = window === WINDOW.EVENING
    ? state.firstReminderSentDay !== streakDay
    : now.getTime() - state.lastAlertTime >= intervalMinutes * 60 * 1000;

  if (!shouldSend) {
    log(`[INFO] Reminder not due yet (${formatIstTime(ist)}).`);
    return { sent: false, window };
  }

  let dcc = null;
  if (window === WINDOW.EVENING) {
    try {
      dcc = await fetchDcc();
    } catch {
      dcc = null;
    }
  }

  const message = buildReminderMessage({ window, ist, dcc });
  const sent = await send(message);

  if (!sent) {
    log(`[WARN] Reminder not sent (${formatIstTime(ist)}). It will retry on the next run.`);
    return { sent: false, window, message };
  }

  state.lastAlertTime = now.getTime();
  state.pendingAlertDay = streakDay;

  if (window === WINDOW.EVENING) {
    state.firstReminderSentDay = streakDay;
  }

  saveState(state);
  log(`[INFO] Reminder sent (${formatIstTime(ist)}).`);

  return { sent: true, window, message };
}

module.exports = {
  WINDOW,
  getISTParts,
  getLeetCodeStreakDay,
  getReminderWindow,
  getReminderIntervalMinutes,
  getMinutesUntilReset,
  formatDuration,
  formatIstTime,
  buildReminderMessage,
  loadState,
  saveState,
  processReminders,
};
