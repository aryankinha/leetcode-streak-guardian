/**
 * src/runOnce.js
 * Single-shot runner for GitHub Actions execution and manual triggers.
 */
const { checkSubmissionsToday, resolveUsername, getDailyCodingChallenge } = require('./leetcodeApi');
const { processReminders, getISTParts } = require('./reminderEngine');
const { sendMessage } = require('./telegramNotifier');
const { getActiveSessionCookies } = require('./sessionManager');
const { performAutoSubmit } = require('./autoSubmit');

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isForceSubmit = args.includes('--force-submit');

  const activeAuth = getActiveSessionCookies();
  const username = resolveUsername() || '(unconfigured)';
  const ist = getISTParts();

  console.log('======================================================');
  console.log(`🛡️  LeetCode Streak Guardian — Single Execution Run`);
  console.log(`👤 User:     ${username}`);
  console.log(`🔑 Auth:     ${activeAuth ? activeAuth.mode.toUpperCase() : 'NONE'}`);
  console.log(`⏰ Time IST: ${String(ist.hour).padStart(2, '0')}:${String(ist.minute).padStart(2, '0')}`);
  if (isDryRun) console.log('🧪 Mode:     DRY-RUN');
  if (isForceSubmit) console.log('⚡ Mode:     FORCE-SUBMIT');
  console.log('======================================================\n');

  try {
    // 1. Check if problem already solved today
    const result = await checkSubmissionsToday();

    if (result.status === 'SOLVED') {
      const title = result.submission?.title || 'Unknown problem';
      console.log(`[INFO] ✅ User "${result.username}" already solved "${title}" today. Streak is safe.`);
      process.exit(0);
    }

    if (result.status === 'ERROR') {
      console.error(`[ERROR] Verification failed: ${result.message}`);
      await sendMessage(`⚠️ Guardian Warning: Could not verify LeetCode streak for "${username}": ${result.message}`);
      process.exit(1);
    }

    console.log(`[INFO] ⏳ No accepted submission found today for "${result.username}".`);

    // Fetch and log DCC
    try {
      const dcc = await getDailyCodingChallenge();
      if (dcc && dcc.title) {
        console.log(`[INFO] 📌 Daily Challenge: "${dcc.title}" (${dcc.difficulty}) - ${dcc.link}`);
      }
    } catch (e) {
      // Non-fatal
    }

    // 2. Direct Force / Dry-run Auto-Submit
    if (isForceSubmit || isDryRun) {
      console.log(`[INFO] Executing direct auto-submit (dryRun=${isDryRun})...`);
      const submitRes = await performAutoSubmit({ dryRun: isDryRun });
      if (submitRes.success) {
        console.log('[INFO] ✅ Auto-submit executed successfully.');
        process.exit(0);
      } else {
        console.error(`[ERROR] Auto-submit failed: ${submitRes.error || submitRes.message}`);
        process.exit(1);
      }
    }

    // 3. Process Reminders and Scheduled Auto-Submit
    await processReminders();
    console.log('[INFO] Guardian cycle completed cleanly.');
    process.exit(0);
  } catch (error) {
    console.error(`[FATAL] Uncaught exception during single run: ${error.message}`);
    await sendMessage(`🚨 CRITICAL: Streak Guardian run failed: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
