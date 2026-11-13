/**
 * Local long-running scheduler. Use this on a VPS or your own machine.
 * GitHub Actions uses runOnce.js instead.
 */
const cron = require('node-cron');
const config = require('./config');
const { runGuardianCycle } = require('./guardian');
const { resolveUsername } = require('./leetcodeApi');
const { getISTParts, formatIstTime } = require('./reminderEngine');
const { log } = require('./logger');

let isChecking = false;

async function main() {
  if (isChecking) {
    log('[WARN] Previous cycle is still running. Skipping this run.');
    return;
  }

  isChecking = true;

  try {
    const result = await runGuardianCycle();
    log(`[INFO] Cycle finished: ${result.status}`);
  } catch (error) {
    log(`[ERROR] Cycle failed: ${error.message}`);
  } finally {
    isChecking = false;
  }
}

const interval = config.checkInterval;
cron.schedule(`*/${interval} * * * *`, main);

const username = resolveUsername() || '(not configured)';
const ist = getISTParts();

log('======================================================');
log('LeetCode Streak Guardian (reminders only)');
log(`User: ${username}`);
log(`Interval: every ${interval} minutes`);
log(`Time: ${formatIstTime(ist)}`);
log('Reminder window: 6:00 PM to 5:30 AM IST');
log('======================================================');

main();

module.exports = { main };
