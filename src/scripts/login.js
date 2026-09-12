const fs = require('fs');
const path = require('path');
const readline = require('readline');
const config = require('../config');
const { chromium } = require('../humanBehavior');
const {
  USER_STATUS_QUERY,
  saveSessionMeta,
  DEFAULT_USER_AGENT,
  verifySessionViaApi,
} = require('../sessionManager');

/**
 * Prompts the user in the CLI.
 */
function promptQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

/**
 * Handles fast, zero-CAPTCHA cookie paste.
 */
async function handleCookiePaste(initialSession = '', initialCsrf = '') {
  console.log('\n======================================================');
  console.log('       Direct Session Paste (Bypasses Cloudflare)      ');
  console.log('======================================================');
  console.log('In your regular browser (Chrome/Brave/Safari) where you');
  console.log('are already logged into LeetCode:');
  console.log('  1. Open DevTools (F12 or Cmd+Option+I)');
  console.log('  2. Go to "Application" -> "Cookies" -> "https://leetcode.com"');
  console.log('  3. Copy the value of "LEETCODE_SESSION"');
  console.log('     (and optionally "csrftoken")\n');

  let sessionToken = initialSession;
  let csrfToken = initialCsrf;

  if (!sessionToken) {
    sessionToken = await promptQuestion('🔑 Paste LEETCODE_SESSION cookie: ');
  }

  // Handle user pasting entire "Cookie: LEETCODE_SESSION=...; csrftoken=..." header
  if (sessionToken.includes('LEETCODE_SESSION=')) {
    const sMatch = sessionToken.match(/LEETCODE_SESSION=([^;]+)/);
    const cMatch = sessionToken.match(/csrftoken=([^;]+)/);
    if (sMatch) sessionToken = sMatch[1].trim();
    if (cMatch && !csrfToken) csrfToken = cMatch[1].trim();
  }

  if (!sessionToken) {
    console.error('❌ Error: No session token entered.');
    process.exit(1);
  }

  if (!csrfToken) {
    csrfToken = await promptQuestion('🔑 Paste csrftoken (optional, press Enter to skip): ');
  }

  console.log('\n🔍 Verifying session with LeetCode API...');
  const check = await verifySessionViaApi(sessionToken, csrfToken);

  if (!check.valid || !check.username) {
    console.error(`\n❌ Verification failed: ${check.reason || 'Invalid or expired session'}`);
    console.error('Make sure you copied the active LEETCODE_SESSION while signed into leetcode.com.');
    process.exit(1);
  }

  // Save Playwright storage state format
  const storageState = {
    cookies: [
      {
        name: 'LEETCODE_SESSION',
        value: sessionToken,
        domain: '.leetcode.com',
        path: '/',
        expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ],
    origins: [],
  };

  if (csrfToken) {
    storageState.cookies.push({
      name: 'csrftoken',
      value: csrfToken,
      domain: '.leetcode.com',
      path: '/',
      expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
    });
  }

  fs.writeFileSync(config.paths.session, JSON.stringify(storageState, null, 2), 'utf-8');
  console.log(`✅ Session state saved to: ${config.paths.session}`);

  saveSessionMeta({
    username: check.username,
    mode: 'session.json',
    loginTimestamp: Date.now(),
  });
  console.log(`✅ Session metadata saved to: ${config.paths.sessionMeta}`);

  // Automatically update .env with valid credentials
  try {
    const envPath = path.join(__dirname, '../../.env');
    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, 'utf-8');
      if (envContent.includes('LEETCODE_SESSION=')) {
        envContent = envContent.replace(/LEETCODE_SESSION=.*/, `LEETCODE_SESSION="${sessionToken}"`);
      } else {
        envContent += `\nLEETCODE_SESSION="${sessionToken}"`;
      }
      if (csrfToken) {
        if (envContent.includes('LEETCODE_CSRF_TOKEN=')) {
          envContent = envContent.replace(/LEETCODE_CSRF_TOKEN=.*/, `LEETCODE_CSRF_TOKEN="${csrfToken}"`);
        } else {
          envContent += `\nLEETCODE_CSRF_TOKEN="${csrfToken}"`;
        }
      }
      if (envContent.includes('LEETCODE_USERNAME=')) {
        envContent = envContent.replace(/LEETCODE_USERNAME=.*/, `LEETCODE_USERNAME="${check.username}"`);
      }
      fs.writeFileSync(envPath, envContent, 'utf-8');
      console.log('✅ Updated .env file with active session.');
    }
  } catch (e) {
    // Non-fatal
  }

  console.log('\n======================================================');
  console.log(`🎉 Login successful! Active username: ${check.username}`);
  console.log('Streak Guardian is ready. You can now run: npm start');
  console.log('======================================================\n');
  process.exit(0);
}

/**
 * Launches an anti-detect browser context configured to bypass Cloudflare Turnstile.
 */
async function launchAntiDetectBrowser() {
  console.log('======================================================');
  console.log('    LeetCode Interactive Login (Anti-Detect Mode)     ');
  console.log('======================================================');

  // Check if official Google Chrome is installed
  const hasChrome =
    fs.existsSync('/Applications/Google Chrome.app') ||
    fs.existsSync('/Applications/Brave Browser.app');

  const profileDir = path.join(config.paths.runtimeDir, 'chrome-login-profile');
  fs.mkdirSync(profileDir, { recursive: true });

  console.log(hasChrome ? 'Launching official Google Chrome...' : 'Launching Chromium...');
  console.log('• Stripped automation flags (--enable-automation removed)');
  console.log('• Masked navigator.webdriver');
  console.log('• Persistent profile active');
  console.log('\nPlease log into LeetCode in the browser window.');
  console.log('Waiting for authentication (timeout: 5 minutes)...');
  console.log('======================================================\n');

  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: hasChrome ? 'chrome' : undefined,
      headless: false,
      // CRUCIAL: Remove --enable-automation so Turnstile doesn't detect test runner
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--start-maximized',
      ],
      viewport: null,
    });

    // Deep evasion script for Cloudflare Turnstile & Google OAuth
    await context.addInitScript(() => {
      // Hide navigator.webdriver
      try {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
      } catch (e) {}

      // Delete standard automation properties
      try {
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
      } catch (e) {}

      // Mock chrome.runtime if missing
      if (!window.chrome) {
        window.chrome = {};
      }
      if (!window.chrome.runtime) {
        window.chrome.runtime = {};
      }
    });

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    let isClosed = false;
    page.on('close', () => {
      isClosed = true;
    });

    await page.goto('https://leetcode.com/accounts/login/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    const startTime = Date.now();
    const timeoutMs = 5 * 60 * 1000;
    let authenticatedUsername = null;

    while (Date.now() - startTime < timeoutMs) {
      if (isClosed) {
        console.error('\n[ERROR] Browser window closed before login was completed.');
        process.exit(1);
      }

      const cookies = await context.cookies('https://leetcode.com');
      const sessionCookie = cookies.find((c) => c.name === 'LEETCODE_SESSION');
      const csrfCookie = cookies.find((c) => c.name === 'csrftoken');

      if (sessionCookie && sessionCookie.value) {
        // Method 1: Check in page if on leetcode.com
        if (page.url().includes('leetcode.com')) {
          try {
            const status = await page.evaluate(
              async ({ queryStr, csrf }) => {
                try {
                  const res = await fetch('/graphql/', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'x-csrftoken': csrf || '',
                    },
                    body: JSON.stringify({ query: queryStr }),
                  });
                  if (!res.ok) return null;
                  const json = await res.json();
                  return json.data?.userStatus;
                } catch (e) {
                  return null;
                }
              },
              { queryStr: USER_STATUS_QUERY, csrf: csrfCookie ? csrfCookie.value : '' }
            );

            if (status && status.isSignedIn && status.username) {
              authenticatedUsername = status.username;
              break;
            }
          } catch (e) {
            // Page navigating
          }
        }

        // Method 2: API check
        try {
          const apiCheck = await verifySessionViaApi(
            sessionCookie.value,
            csrfCookie ? csrfCookie.value : ''
          );
          if (apiCheck.valid && apiCheck.username) {
            authenticatedUsername = apiCheck.username;
            break;
          }
        } catch (e) {}
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    if (!authenticatedUsername) {
      console.error('\n[ERROR] Login timed out without detecting an authenticated session.');
      await context.close();
      process.exit(1);
    }

    // Save session storage state
    await context.storageState({ path: config.paths.session });
    console.log(`\n[SUCCESS] Session saved to: ${config.paths.session}`);

    saveSessionMeta({
      username: authenticatedUsername,
      mode: 'session.json',
      loginTimestamp: Date.now(),
    });
    console.log(`[SUCCESS] Session metadata saved to: ${config.paths.sessionMeta}`);

    console.log('\n======================================================');
    console.log(`🎉 Login successful! Active username: ${authenticatedUsername}`);
    console.log('Streak Guardian is primed. You can now run: npm start');
    console.log('======================================================\n');

    await context.close();
    process.exit(0);
  } catch (err) {
    console.error('\n[FATAL] Error launching browser:', err.message);
    if (context) await context.close().catch(() => {});
    process.exit(1);
  }
}

/**
 * Main entry point.
 */
async function main() {
  const args = process.argv.slice(2);

  // Direct CLI flag: npm run login -- --cookie <TOKEN>
  const cookieArgIdx = args.findIndex((a) => a === '--cookie' || a === '-c');
  if (cookieArgIdx !== -1 && args[cookieArgIdx + 1]) {
    await handleCookiePaste(args[cookieArgIdx + 1]);
    return;
  }

  // If argument is passed directly without flag
  if (args[0] && !args[0].startsWith('-')) {
    await handleCookiePaste(args[0]);
    return;
  }

  console.log('======================================================');
  console.log('        LeetCode Streak Guardian — Sign In            ');
  console.log('======================================================');
  console.log('How would you like to authenticate?');
  console.log('  [1] Open Google Chrome (Anti-Detect mode — Cloudflare bypass)');
  console.log('  [2] Paste session cookie (Instant, 0 CAPTCHAs, 100% reliable)\n');

  const choice = await promptQuestion('Select option [1 or 2] (default: 1): ');

  if (choice === '2') {
    await handleCookiePaste();
  } else {
    await launchAntiDetectBrowser();
  }
}

if (require.main === module) {
  main();
}

module.exports = { loginCLI: launchAntiDetectBrowser, handleCookiePaste };
