const fs = require('fs');
const config = require('./config');

/**
 * Logs to stdout (captured by GitHub Actions) and to logs/app.log locally.
 * CI runners are ephemeral, so skip the file write there.
 */
function log(message) {
  console.log(message);

  if (process.env.GITHUB_ACTIONS === 'true') return;

  try {
    fs.appendFileSync(
      config.paths.logs,
      `[${new Date().toISOString()}] ${message}\n`
    );
  } catch {
    // Logging must never break a guardian run.
  }
}

module.exports = { log };
