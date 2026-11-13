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
 * Builds the streak-safe confirmation. Wrong answers keep the streak too,
 * so the wording distinguishes accepted submissions from other submissions.
 */
function buildStreakSafeMessage(submission, streakDay) {
  if (submission?.accepted) {
    return [
      '✅ LeetCode streak safe',
      `Accepted: ${submission.title}`,
      `Date: ${streakDay}`,
      'Well done, sir.',
    ].join('\n');
  }

  if (submission?.title) {
    const status = submission.statusDisplay ? ` (${submission.statusDisplay})` : '';
    return [
      '✅ LeetCode streak safe',
      `Submitted: ${submission.title}${status}`,
      `Date: ${streakDay}`,
      'Streak secured, sir.',
    ].join('\n');
  }

  return [
    '✅ LeetCode streak safe',
    'Submission recorded today',
    `Date: ${streakDay}`,
    'Streak secured, sir.',
  ].join('\n');
}

/**
 * Confirms the streak is safe, but only if the user was already reminded today.
 * If they submit before the first reminder, no extra message is sent.
 */
async function notifyStreakSafe(submission) {
  const state = loadState();
  const streakDay = getLeetCodeStreakDay();

  if (state.pendingAlertDay !== streakDay || state.safeNotifiedDay === streakDay) {
    return false;
  }

  const sent = await sendMessage(buildStreakSafeMessage(submission, streakDay));

  if (sent) {
    state.safeNotifiedDay = streakDay;
    saveState(state);
  }

  return sent;
}

async function sendTestAlert() {
  const ist = getISTParts();
  const result = await checkSubmissionsToday();

  if (result.status === 'SAFE') {
    const submission = result.submission;
    const detail = submission?.accepted
      ? `Accepted: ${submission.title}`
      : `Submitted: ${submission?.title || 'unknown'} (${submission?.statusDisplay || 'not accepted'})`;

    return sendMessage(`✅ Test alert: today's LeetCode streak is safe\n${detail}`);
  }

  if (result.status === 'PENDING') {
    return sendMessage(
      `📌 Test alert: today's LeetCode streak is pending\nNo submission today.\nTime: ${formatIstTime(ist)}`
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

    if (result.status === 'SAFE') {
      const title = result.submission?.title || 'submission';
      const status = result.submission?.statusDisplay || 'unknown status';
      log(`[INFO] Streak safe: ${title} (${status}).`);
      await notifyStreakSafe(result.submission);
      return { ok: true, status: 'SAFE' };
    }

    if (result.status === 'ERROR') {
      log(`[ERROR] Could not verify submissions: ${result.message}`);
      await notifyVerificationErrorOnce(result.message);
      return { ok: false, status: 'ERROR', message: result.message };
    }

    log('[INFO] No submission today. Checking the reminder window...');
    const reminder = await processReminders();
    return { ok: true, status: 'PENDING', reminder };
  } catch (error) {
    log(`[ERROR] Guardian cycle failed: ${error.message}`);
    await notifyVerificationErrorOnce(error.message);
    return { ok: false, status: 'ERROR', message: error.message };
  }
}

module.exports = {
  runGuardianCycle,
  buildStreakSafeMessage,
  notifyVerificationErrorOnce,
  notifyStreakSafe,
};
