const fs = require('fs');
const config = require('./config');
const { sendMessage } = require('./telegramNotifier');
const { performAutoSubmit } = require('./autoSubmit');

/**
 * Parses current time in Asia/Kolkata (IST).
 */
function getISTParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((p) => [p.type, p.value])
  );

  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10),
    istDateStr: `${parts.year}-${parts.month}-${parts.day}`,
    totalMinutesFromMidnight: parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10),
  };
}

/**
 * Returns the current LeetCode streak day.
 * LeetCode daily challenge resets at 00:00 UTC (05:30 AM IST).
 * Therefore, UTC date string (YYYY-MM-DD) perfectly corresponds to the streak day.
 */
function getLeetCodeStreakDay(date = new Date()) {
  return date.toISOString().split('T')[0];
}

/**
 * Loads or initializes persistent runtime state (reminders, auto-submit counts, jitter).
 */
function loadState() {
  const filePath = config.paths.runtimeState;
  const currentStreakDay = getLeetCodeStreakDay();

  const defaultState = {
    streakDay: currentStreakDay,
    // Jitter between 2:15 AM (135 min) and 3:45 AM (225 min) in IST
    autoSubmitJitterMinutes: Math.floor(Math.random() * (225 - 135 + 1)) + 135,
    firstReminderSentDay: null,
    lastAlertTime: 0,
    autoSubmit: {
      lastAttemptTime: 0,
      attemptCount: 0,
      succeeded: false,
    },
  };

  if (!fs.existsSync(filePath)) {
    saveState(defaultState);
    return defaultState;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const state = JSON.parse(raw);

    // If day rolled over (new streak day after 00:00 UTC / 05:30 IST), reset daily counters
    if (state.streakDay !== currentStreakDay) {
      console.log(`[INFO] New LeetCode streak day detected: ${currentStreakDay} (was ${state.streakDay}). Resetting daily state.`);
      state.streakDay = currentStreakDay;
      state.autoSubmitJitterMinutes = Math.floor(Math.random() * (225 - 135 + 1)) + 135;
      state.firstReminderSentDay = null;
      state.autoSubmit = {
        lastAttemptTime: 0,
        attemptCount: 0,
        succeeded: false,
      };
      saveState(state);
    }

    // Ensure nested autoSubmit object is always properly structured
    state.autoSubmit = {
      lastAttemptTime: state.autoSubmit?.lastAttemptTime || 0,
      attemptCount: state.autoSubmit?.attemptCount || 0,
      succeeded: state.autoSubmit?.succeeded || false,
    };

    return state;
  } catch (err) {
    console.warn('[WARN] Failed to load runtime state, resetting:', err.message);
    saveState(defaultState);
    return defaultState;
  }
}

/**
 * Persists runtime state to runtime/state.json.
 */
function saveState(state) {
  try {
    fs.writeFileSync(config.paths.runtimeState, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('[ERROR] Failed to write runtime/state.json:', err.message);
  }
}

/**
 * Main reminder and auto-submit processor.
 * Schedule:
 * - 6:00 PM IST: Initial daily check (once per streak day)
 * - 8:00 PM - 10:00 PM IST: Hourly alerts
 * - 10:00 PM - 1:00 AM IST: Alerts every 15 minutes
 * - 1:00 AM - 5:30 AM IST: Alerts every 5 minutes
 * - 2:15 AM - 3:45 AM IST (with jitter): Auto-submit emergency streak saver
 */
async function processReminders() {
  const now = new Date();
  const ist = getISTParts(now);
  const streakDay = getLeetCodeStreakDay(now);
  const state = loadState();

  const timeStr = `${String(ist.hour).padStart(2, '0')}:${String(ist.minute).padStart(2, '0')}`;
  console.log(`[INFO] Current IST: ${timeStr} | Streak Day (UTC): ${streakDay}`);

  const hours = ist.hour;
  const minutes = ist.minute;
  const totalMinutes = ist.totalMinutesFromMidnight;
  const currentTimestamp = now.getTime();

  let shouldSendAlert = false;
  let alertMessage = '';

  // 1. Critical window: 1:00 AM to 5:30 AM IST
  if (hours === 1 || (hours >= 2 && hours < 5) || (hours === 5 && minutes < 30)) {
    // If auto-submit already succeeded for this streak day, streak is safe!
    if (state.autoSubmit?.succeeded) {
      console.log('[INFO] Auto-submit has already succeeded for this streak day. No critical alert needed.');
      return;
    }

    // Alert every 5 minutes
    if (currentTimestamp - state.lastAlertTime >= 5 * 60 * 1000) {
      shouldSendAlert = true;
      alertMessage = `🚨 *CRITICAL: LeetCode Streak at Risk!*\n\n` +
        `You haven't solved a problem today.\n` +
        `Current time: *${timeStr} IST* (Reset is at 05:30 AM IST).\n` +
        `Solve one now to keep your streak alive!`;
    }

    // Auto-submit evaluation
    const jitterThresholdMinutes = state.autoSubmitJitterMinutes || 150; // default 2:30 AM if missing
    const hasReachedJitter = totalMinutes >= jitterThresholdMinutes;
    const { lastAttemptTime, attemptCount, succeeded } = state.autoSubmit;
    const cooldownMs = 30 * 60 * 1000; // 30 minutes cooldown between retries
    const maxRetries = 3;

    if (hasReachedJitter && !succeeded && attemptCount < maxRetries) {
      const timeSinceLastAttempt = currentTimestamp - lastAttemptTime;

      if (lastAttemptTime === 0 || timeSinceLastAttempt >= cooldownMs) {
        console.log(`[INFO] Triggering auto-submit (Attempt ${attemptCount + 1}/${maxRetries}, Jitter threshold: ${Math.floor(jitterThresholdMinutes / 60)}:${String(jitterThresholdMinutes % 60).padStart(2, '0')} IST)...`);

        // Update attempt timestamp and counter BEFORE running to prevent tight loops on failure
        state.autoSubmit.lastAttemptTime = currentTimestamp;
        state.autoSubmit.attemptCount += 1;
        saveState(state);

        const result = await performAutoSubmit();

        if (result && result.success) {
          state.autoSubmit.succeeded = true;
          shouldSendAlert = false; // SUPPRESS CRITICAL ALERT ON SUCCESS
          console.log('[INFO] Auto-submit succeeded and marked complete for this streak day.');
        } else {
          console.warn(`[WARN] Auto-submit attempt ${state.autoSubmit.attemptCount} failed. Cooldown active for 30 minutes.`);
        }
        saveState(state);
      }
    }
  }
  // 2. High urgency window: 10:00 PM to 1:00 AM IST
  else if (hours >= 22 || hours === 0) {
    if (currentTimestamp - state.lastAlertTime >= 15 * 60 * 1000) {
      shouldSendAlert = true;
      alertMessage = `⚠️ *WARNING: Streak Expiring Tonight!*\n\n` +
        `You have not submitted a LeetCode problem yet.\n` +
        `Current time: *${timeStr} IST*.\n` +
        `Please submit a solution soon.`;
    }
  }
  // 3. Moderate urgency window: 8:00 PM to 10:00 PM IST
  else if (hours >= 20 && hours < 22) {
    if (currentTimestamp - state.lastAlertTime >= 60 * 60 * 1000) {
      shouldSendAlert = true;
      alertMessage = `🔔 *Hourly Reminder: LeetCode Streak*\n\n` +
        `Don't forget to solve your daily problem!\n` +
        `Current time: *${timeStr} IST*.`;
    }
  }
  // 4. Evening window: 6:00 PM to 8:00 PM IST
  else if (hours >= 18 && hours < 20) {
    // Send once per streak day
    if (state.firstReminderSentDay !== streakDay) {
      shouldSendAlert = true;
      alertMessage = `ℹ️ *Daily LeetCode Check*\n\n` +
        `You haven't submitted anything today yet.\n` +
        `Time: *${timeStr} IST*. Take a few minutes to protect your streak!`;
      state.firstReminderSentDay = streakDay;
    }
  }

  if (shouldSendAlert && alertMessage) {
    console.log(`[INFO] Sending reminder alert for time ${timeStr} IST...`);
    await sendMessage(alertMessage);
    state.lastAlertTime = currentTimestamp;
    saveState(state);
  }
}

module.exports = {
  getISTParts,
  getLeetCodeStreakDay,
  loadState,
  saveState,
  processReminders,
};
