/**
 * Single-shot runner for GitHub Actions and manual runs.
 */
const { runGuardianCycle } = require('./guardian');
const { getISTParts, formatIstTime } = require('./reminderEngine');
const { log } = require('./logger');

async function main() {
  const args = process.argv.slice(2);
  const testAlert = args.includes('--test-alert');
  const ist = getISTParts();

  log('======================================================');
  log('LeetCode Streak Guardian — single run');
  log(`Time: ${formatIstTime(ist)}`);
  if (testAlert) log('Mode: test alert');
  log('======================================================');

  const result = await runGuardianCycle({ testAlert });
  log(`[INFO] Result: ${result.status}`);

  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((error) => {
    log(`[FATAL] ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main };
