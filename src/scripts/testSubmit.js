const { performAutoSubmit } = require('../autoSubmit');

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run') || args.includes('-d');
  const isHeaded = args.includes('--headed');

  console.log('======================================================');
  console.log('      LeetCode Streak Guardian — Auto-Submit Test     ');
  console.log('======================================================');
  console.log(`Dry Run Mode: ${isDryRun ? 'ENABLED (will not submit)' : 'DISABLED (WILL SUBMIT)'}`);
  console.log(`Headed Mode:  ${isHeaded ? 'ENABLED (visible browser)' : 'DISABLED (headless)'}`);
  console.log('======================================================\n');

  try {
    const result = await performAutoSubmit({
      dryRun: isDryRun,
      headed: isHeaded,
      // Use abbreviated dwell for tests unless configured
      dwellMin: isDryRun ? 3 : 10,
      dwellMax: isDryRun ? 6 : 20,
    });

    if (result.success) {
      console.log('\n======================================================');
      console.log('✅ TEST SUBMIT COMPLETED SUCCESSFULLY');
      if (result.dryRun) {
        console.log(`Problem Tested: "${result.problem.title}" (${result.problem.slug})`);
        console.log('Monaco code injection verified.');
      } else {
        console.log(`Problem Submitted: "${result.problem.title}"`);
        console.log(`Submission ID:     ${result.submissionId}`);
        console.log(`Verdict:           ${result.verdict?.status_msg}`);
      }
      console.log('======================================================\n');
      process.exit(0);
    } else {
      console.error('\n======================================================');
      console.error('❌ TEST SUBMIT FAILED');
      console.error(`Error: ${result.error || 'Unknown error'}`);
      console.error(`Message: ${result.message || 'No additional details'}`);
      console.error('======================================================\n');
      process.exit(1);
    }
  } catch (err) {
    console.error('\n[FATAL] Error running test submit:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
