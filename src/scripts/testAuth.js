const fs = require('fs');
const config = require('../config');
const {
  getActiveSessionCookies,
  verifySessionViaApi,
  getSessionMeta,
  saveSessionMeta,
  ensureAuthenticatedSession,
} = require('../sessionManager');

async function testAuth() {
  console.log('======================================================');
  console.log('         LeetCode Streak Guardian Auth Check          ');
  console.log('======================================================');

  const sessionInfo = getActiveSessionCookies();
  const sessionMeta = getSessionMeta();

  if (!sessionInfo) {
    console.error('❌ No active authentication credentials found.');
    console.log('\nTo authenticate, choose one of two options:');
    console.log('  Option A (Interactive Login): Run `npm run login` to sign in via browser.');
    console.log('  Option B (.env file): Set LEETCODE_SESSION and LEETCODE_CSRF_TOKEN in your .env file.\n');
    process.exit(1);
  }

  console.log(`[AUTH SOURCE] Detected mode: ${sessionInfo.mode.toUpperCase()}`);
  if (sessionInfo.mode === 'session.json') {
    console.log(`[STORAGE PATH] ${config.paths.session}`);
  }

  // Mask session token for security
  const maskedSession = sessionInfo.sessionToken
    ? `${sessionInfo.sessionToken.slice(0, 8)}...${sessionInfo.sessionToken.slice(-6)}`
    : 'None';
  console.log(`[SESSION TOKEN] ${maskedSession}`);
  console.log(`[CSRF TOKEN]    ${sessionInfo.csrfToken ? 'Present' : 'Not provided'}`);

  // Check cookie expiration from session.json if available
  if (sessionInfo.mode === 'session.json' && fs.existsSync(config.paths.session)) {
    try {
      const data = JSON.parse(fs.readFileSync(config.paths.session, 'utf-8'));
      const sessionCookie = data.cookies?.find((c) => c.name === 'LEETCODE_SESSION');
      if (sessionCookie && sessionCookie.expires && sessionCookie.expires > 0) {
        const expiryDate = new Date(sessionCookie.expires * 1000);
        const hoursRemaining = ((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60)).toFixed(1);
        console.log(`[EXPIRATION]    Expires on ${expiryDate.toLocaleString()} (~${hoursRemaining} hours remaining)`);
      }
    } catch (e) {
      // Ignore
    }
  }

  console.log('\nVerifying session against LeetCode GraphQL...');

  // Try API verification first (fastest)
  let apiResult = await verifySessionViaApi(sessionInfo.sessionToken, sessionInfo.csrfToken);

  if (apiResult.valid) {
    saveSessionMeta({
      username: apiResult.username,
      mode: sessionInfo.mode,
      verifiedAt: new Date().toISOString(),
    });
    console.log('======================================================');
    console.log('✅ AUTHENTICATION STATUS: SUCCESSFUL');
    console.log(`👤 Logged in as: ${apiResult.username}`);
    console.log('======================================================\n');
    process.exit(0);
  }

  // If API check was blocked by Cloudflare (e.g. 403) or failed, test via stealth browser context
  console.log(`[NOTICE] API check returned: ${apiResult.reason || 'Unverified'}. Testing via stealth browser context...`);

  const browserCheck = await ensureAuthenticatedSession({ headless: true });
  if (browserCheck.success) {
    console.log('======================================================');
    console.log('✅ AUTHENTICATION STATUS: SUCCESSFUL (Verified via Stealth Browser)');
    console.log(`👤 Logged in as: ${browserCheck.username}`);
    console.log('======================================================\n');
    if (browserCheck.browser) await browserCheck.browser.close();
    process.exit(0);
  } else {
    console.error('======================================================');
    console.error('❌ AUTHENTICATION STATUS: FAILED');
    console.error(`Reason: ${browserCheck.message || 'Session expired or rejected by LeetCode.'}`);
    console.error('Please run `npm run login` to re-authenticate.');
    console.error('======================================================\n');
    process.exit(1);
  }
}

if (require.main === module) {
  testAuth();
}

module.exports = { testAuth };
