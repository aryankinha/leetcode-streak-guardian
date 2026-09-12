const cron = require('node-cron');
const fs = require('fs');
const config = require('./config');
const { checkSubmissionsToday, resolveUsername, getDailyCodingChallenge } = require('./leetcodeApi');
const { processReminders } = require('./reminderEngine');
const { sendMessage } = require('./telegramNotifier');
const { getActiveSessionCookies } = require('./sessionManager');

// Mutex lock to prevent overlapping runs
let isChecking = false;

function logToFile(message) {
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] ${message}\n`;
  console.log(message);
  try {
    fs.appendFileSync(config.paths.logs, formattedMessage);
  } catch (err) {
    console.error('Failed to write to log file:', err.message);
  }
}

async function main() {
  if (isChecking) {
    logToFile('[WARN] Previous guardian cycle is still active. Skipping overlapping run.');
    return;
  }

  isChecking = true;
  logToFile('[INFO] 🔍 Starting LeetCode Streak Guardian check...');

  try {
    const result = await checkSubmissionsToday();

    if (result.status === 'SOLVED') {
      const title = result.submission?.title || 'Unknown problem';
      logToFile(`[INFO] ✅ User "${result.username}" already solved "${title}" today. Streak is safe.`);
    } else if (result.status === 'UNSOLVED') {
      logToFile(`[INFO] ⏳ No accepted submission found today for "${result.username}". Evaluating reminders...`);
      try {
        const dcc = await getDailyCodingChallenge();
        if (dcc && dcc.title) {
          logToFile(`[INFO] 📌 Today's Daily Challenge: "${dcc.title}" (${dcc.difficulty}) - ${dcc.link}`);
        }
      } catch (e) {
        // Ignore
      }
      await processReminders();
    } else if (result.status === 'ERROR') {
      logToFile(`[WARN] ⚠️ Could not verify submissions: ${result.message}. Skipping alerts this cycle to prevent false alarms.`);
    }
  } catch (error) {
    logToFile(`[ERROR] Critical failure in main process: ${error.message}`);
    await sendMessage(`🚨 CRITICAL ERROR: LeetCode Streak Guardian encountered an issue: ${error.message}`);
  } finally {
    isChecking = false;
    logToFile('[INFO] Check cycle finished.');
  }
}

// Scheduled task every CHECK_INTERVAL minutes
cron.schedule(`*/${config.checkInterval} * * * *`, async () => {
  await main();
});

// Startup Banner and First Run
const activeAuth = getActiveSessionCookies();
const activeUsername = resolveUsername() || '(unconfigured)';
logToFile('======================================================');
logToFile(`[INFO] 🛡️  LeetCode Streak Guardian Started`);
logToFile(`[INFO] Username:     ${activeUsername}`);
logToFile(`[INFO] Auth Mode:    ${activeAuth ? activeAuth.mode.toUpperCase() : 'NONE'}`);
logToFile(`[INFO] Interval:     Every ${config.checkInterval} minutes`);
logToFile(`[INFO] Timezone:     Asia/Kolkata (IST reset at 05:30)`);
logToFile('======================================================');

main().catch((err) => {
  console.error('[ERROR] Initial execution failed:', err);
});

module.exports = { main, isChecking: () => isChecking };
