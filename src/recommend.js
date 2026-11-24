#!/usr/bin/env node
/**
 * Standalone recommendation report.
 *
 *   npm run recommend
 *   npm run recommend -- --json
 *   npm run recommend -- --refresh
 */
const { getDailyRecommendation } = require('./recommendationService');
const { formatRecommendation } = require('./recommender');
const { log } = require('./logger');

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    refresh: argv.includes('--refresh'),
    dryRun: argv.includes('--dry-run'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function formatReport(result) {
  const { profile, limitations } = result;
  const lines = [];

  lines.push(`LeetCode recommendation — ${result.username}`);
  lines.push(
    `Solved: ${profile.solved.All} (Easy ${profile.solved.Easy} / Medium ${profile.solved.Medium} / Hard ${profile.solved.Hard})`
  );
  lines.push(
    `Streak: ${profile.streak} days | Status checks: ${result.verified ? 'verified' : 'unverified'}`
  );
  lines.push('');
  lines.push(formatRecommendation(result));

  lines.push('');
  lines.push('Weakest topics:');
  for (const topic of profile.weakestTopics) {
    lines.push(
      `- ${topic.label}: ${topic.solved}/${topic.total} (${topic.coveragePct}%)`
    );
  }

  if (limitations.length > 0) {
    lines.push('');
    lines.push('Limitations:');
    for (const limitation of limitations) lines.push(`- ${limitation}`);
  }

  return lines.join('\n');
}

function printHelp() {
  console.log(
    [
      'Usage: npm run recommend -- [options]',
      '',
      'Options:',
      '  --json      Print the raw recommendation result',
      '  --refresh   Ignore the cached recommendation for today',
      '  --dry-run   Do not write the recommendation cache',
      '  -h, --help  Show this help',
    ].join('\n')
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const result = await getDailyRecommendation({
    force: args.refresh,
    persist: !args.dryRun,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(formatReport(result));
}

if (require.main === module) {
  main().catch((error) => {
    log(`[ERROR] Recommendation failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs, formatReport };
