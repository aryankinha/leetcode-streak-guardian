const { checkSubmissionsToday } = require('./leetcodeApi');
const {
  loadState,
  saveState,
  getLeetCodeStreakDay,
  getISTParts,
  formatIstTime,
  processReminders,
} = require('./reminderEngine');
const { sendMessage } = require('./telegramNotifier');
const { log } = require('./logger');

const ERROR_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * Sends a verification-failure message at most once every 6 hours.
 * Prevents one broken API cycle from producing an alert every 10 minutes.
 */
async function notifyVerificationErrorOnce(message) {
  const state = loadState();
  const now = Date.now();

  if (now - state.lastErrorAlertTime < ERROR_ALERT_COOLDOWN_MS) {
    log('[WARN] Verification error alert suppressed (6-hour cooldown).');
    return false;
  }

  const sent = await sendMessage(
    `⚠️ LeetCode check failed\nReason: ${message}\nNo reminder was sent for this cycle.`
  );

  if (sent) {
    state.lastErrorAlertTime = now;
    saveState(state);
  }

  return sent;
}

/**
 * Confirms the streak is safe, but only if the user was already reminded today.
 * If they solve before the first reminder, no extra message is sent.
 */
async function notifyStreakSafe(submission) {
  const state = loadState();
  const streakDay = getLeetCodeStreakDay();

  if (state.pendingAlertDay !== streakDay || state.safeNotifiedDay === streakDay) {
    return false;
  }

  const title = submission?.title || 'Accepted submission';
  const sent = await sendMessage(
    `✅ LeetCode streak safe\nAccepted: ${title}\nDate: ${streakDay}\nWell done, sir.`
  );

  if (sent) {
    state.safeNotifiedDay = streakDay;
    saveState(state);
  }

  return sent;
}

async function sendTestAlert() {
  const ist = getISTParts();
  const result = await checkSubmissionsToday();

  if (result.status === 'SOLVED') {
    return sendMessage(
      `✅ Test alert: today's LeetCode streak is safe\nAccepted: ${result.submission?.title || 'Unknown'}`
    );
  }

  if (result.status === 'UNSOLVED') {
    return sendMessage(
      `📌 Test alert: today's LeetCode streak is pending\nNo accepted submission today.\nTime: ${formatIstTime(ist)}`
    );
  }

  return sendMessage(`⚠️ Test alert: LeetCode check failed\nReason: ${result.message}`);
}

async function runGuardianCycle({ testAlert = false } = {}) {
  try {
    if (testAlert) {
      const sent = await sendTestAlert();
      return { ok: sent, status: 'TEST_ALERT' };
    }

    log("[INFO] Checking today's LeetCode submissions...");
    const result = await checkSubmissionsToday();

    if (result.status === 'SOLVED') {
      log(`[INFO] Streak safe: ${result.submission?.title || 'accepted submission'}.`);
      await notifyStreakSafe(result.submission);
      return { ok: true, status: 'SOLVED' };
    }

    if (result.status === 'ERROR') {
      log(`[ERROR] Could not verify submissions: ${result.message}`);
      await notifyVerificationErrorOnce(result.message);
      return { ok: false, status: 'ERROR', message: result.message };
    }

    log('[INFO] No accepted submission today. Checking the reminder window...');
    const reminder = await processReminders();
    return { ok: true, status: 'UNSOLVED', reminder };
  } catch (error) {
    log(`[ERROR] Guardian cycle failed: ${error.message}`);
    await notifyVerificationErrorOnce(error.message);
    return { ok: false, status: 'ERROR', message: error.message };
  }
}

module.exports = {
  runGuardianCycle,
  notifyVerificationErrorOnce,
  notifyStreakSafe,
};
