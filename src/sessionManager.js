const fs = require('fs');
const axios = require('axios');
const config = require('./config');
const { chromium, randomDelay } = require('./humanBehavior');
const { sendMessage } = require('./telegramNotifier');

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const USER_STATUS_QUERY = `
  query globalData {
    userStatus {
      isSignedIn
      username
    }
  }
`;

/**
 * Reads session-meta.json if present.
 */
function getSessionMeta() {
  if (fs.existsSync(config.paths.sessionMeta)) {
    try {
      const data = fs.readFileSync(config.paths.sessionMeta, 'utf-8');
      return JSON.parse(data);
    } catch (e) {
      return null;
    }
  }
  return null;
}

/**
 * Saves metadata about the active session (username, timestamp, auth mode).
 */
function saveSessionMeta(meta) {
  try {
    const existing = getSessionMeta() || {};
    const updated = {
      ...existing,
      ...meta,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(config.paths.sessionMeta, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (err) {
    console.error('[ERROR] Failed to write session-meta.json:', err.message);
  }
}

/**
 * Resolves active session cookies from Mode 1 (.env) or Mode 2 (runtime/session.json).
 */
function getActiveSessionCookies() {
  // Mode 2: Check runtime/session.json first
  if (fs.existsSync(config.paths.session)) {
    try {
      const sessionData = JSON.parse(fs.readFileSync(config.paths.session, 'utf-8'));
      if (sessionData.cookies && Array.isArray(sessionData.cookies)) {
        const sessionCookie = sessionData.cookies.find(c => c.name === 'LEETCODE_SESSION');
        const csrfCookie = sessionData.cookies.find(c => c.name === 'csrftoken');
        if (sessionCookie) {
          return {
            mode: 'session.json',
            sessionToken: sessionCookie.value,
            csrfToken: csrfCookie ? csrfCookie.value : '',
            storageStatePath: config.paths.session,
          };
        }
      }
    } catch (err) {
      console.warn('[WARN] Failed to parse runtime/session.json:', err.message);
    }
  }

  // Mode 1: Fallback to .env tokens
  const envSession = config.leetcode.session?.trim();
  const placeholders = ['your_session', 'your_session_token', 'your_leetcode_session', ''];
  if (envSession && !placeholders.includes(envSession.toLowerCase())) {
    return {
      mode: 'env',
      sessionToken: envSession,
      csrfToken: config.leetcode.csrfToken || '',
      storageStatePath: null,
    };
  }

  return null;
}

/**
 * Queries LeetCode GraphQL userStatus to verify authentication and extract username.
 */
async function verifySessionViaApi(sessionToken, csrfToken) {
  try {
    const cookieHeader = [
      `LEETCODE_SESSION=${sessionToken}`,
      csrfToken ? `csrftoken=${csrfToken}` : '',
    ].filter(Boolean).join('; ');

    const response = await axios.post(
      config.leetcode.graphqlUrl,
      { query: USER_STATUS_QUERY },
      {
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieHeader,
          'Referer': 'https://leetcode.com',
          'Origin': 'https://leetcode.com',
          'x-csrftoken': csrfToken || '',
          'User-Agent': DEFAULT_USER_AGENT,
        },
        timeout: 10000,
      }
    );

    const userStatus = response.data?.data?.userStatus;
    if (userStatus && userStatus.isSignedIn) {
      return {
        valid: true,
        username: userStatus.username,
      };
    }
    return { valid: false, username: null, reason: 'userStatus.isSignedIn is false' };
  } catch (err) {
    return { valid: false, username: null, reason: err.message };
  }
}

/**
 * Checks session validity inside a browser page via in-page GraphQL query.
 */
async function checkLoginStateInPage(page) {
  try {
    const result = await page.evaluate(async (queryStr) => {
      try {
        const match = document.cookie.match(/csrftoken=([^;]+)/);
        const csrf = match ? match[1] : '';
        const res = await fetch('/graphql/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrftoken': csrf,
          },
          body: JSON.stringify({ query: queryStr }),
        });
        if (!res.ok) return { isSignedIn: false };
        const json = await res.json();
        return json.data?.userStatus || { isSignedIn: false };
      } catch (e) {
        return { isSignedIn: false, error: e.message };
      }
    }, USER_STATUS_QUERY);

    if (result && result.isSignedIn) {
      return { loggedIn: true, username: result.username };
    }
    return { loggedIn: false, username: null };
  } catch (err) {
    console.error('[WARN] Failed to verify login in page:', err.message);
    return { loggedIn: false, username: null };
  }
}

/**
 * Creates and launches an authenticated Playwright browser and context
 * configured with stealth plugins, realistic user-agent, and session cookies.
 */
async function getAuthenticatedBrowserContext(options = {}) {
  const browser = await chromium.launch({
    headless: options.headless !== undefined ? options.headless : true,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
    ],
  });

  const sessionInfo = getActiveSessionCookies();
  let contextOptions = {
    userAgent: DEFAULT_USER_AGENT,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  };

  if (sessionInfo?.storageStatePath && fs.existsSync(sessionInfo.storageStatePath)) {
    contextOptions.storageState = sessionInfo.storageStatePath;
  }

  const context = await browser.newContext(contextOptions);

  // If Mode 1 (.env), inject cookies into context directly
  if (sessionInfo && sessionInfo.mode === 'env' && sessionInfo.sessionToken) {
    const cookiesToAdd = [
      {
        name: 'LEETCODE_SESSION',
        value: sessionInfo.sessionToken,
        domain: '.leetcode.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ];
    if (sessionInfo.csrfToken) {
      cookiesToAdd.push({
        name: 'csrftoken',
        value: sessionInfo.csrfToken,
        domain: '.leetcode.com',
        path: '/',
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
      });
    }
    await context.addCookies(cookiesToAdd);
  }

  return { browser, context, sessionInfo };
}

/**
 * Ensures authenticated session is valid, refreshes storage state,
 * and updates session metadata.
 */
async function ensureAuthenticatedSession(options = {}) {
  const sessionInfo = getActiveSessionCookies();
  if (!sessionInfo) {
    if (options.allowAnonymous) {
      console.log('[INFO] No active session found. Continuing in anonymous inspection mode.');
      const { browser, context } = await getAuthenticatedBrowserContext(options);
      const page = await context.newPage();
      return { browser, context, page, success: true, username: 'Anonymous (Dry Run)', isAnonymous: true };
    }
    console.error('[ERROR] No LeetCode session found. Please run "npm run login" or set LEETCODE_SESSION in .env.');
    return {
      success: false,
      error: 'NO_SESSION',
      message: 'No session credentials configured. Run "npm run login" or provide LEETCODE_SESSION in .env.',
    };
  }

  console.log(`[INFO] Authenticating using Mode: ${sessionInfo.mode}...`);
  const { browser, context } = await getAuthenticatedBrowserContext(options);
  const page = await context.newPage();

  try {
    console.log('[INFO] Verifying session against LeetCode GraphQL...');
    await page.goto('https://leetcode.com/problemset/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(1000, 2000);

    const { loggedIn, username } = await checkLoginStateInPage(page);

    if (loggedIn) {
      console.log(`[INFO] ✅ Session verified. Authenticated as: ${username}`);

      // Persist latest storage state to runtime/session.json
      await context.storageState({ path: config.paths.session });

      // Persist session metadata
      saveSessionMeta({
        username,
        mode: sessionInfo.mode,
        verifiedAt: new Date().toISOString(),
      });

      return { browser, context, page, success: true, username };
    }

    console.warn('[WARN] Session is expired or invalid.');
    await browser.close();
    await sendMessage('⚠️ LeetCode session has expired or is invalid. Please run "npm run login" to re-authenticate.');

    return {
      success: false,
      error: 'SESSION_EXPIRED',
      message: 'Session has expired. Manual re-authentication via "npm run login" required.',
    };
  } catch (err) {
    console.error('[ERROR] Error during session verification:', err.message);
    if (browser) await browser.close();
    return {
      success: false,
      error: 'VERIFICATION_FAILED',
      message: err.message,
    };
  }
}

module.exports = {
  DEFAULT_USER_AGENT,
  USER_STATUS_QUERY,
  getSessionMeta,
  saveSessionMeta,
  getActiveSessionCookies,
  verifySessionViaApi,
  checkLoginStateInPage,
  getAuthenticatedBrowserContext,
  ensureAuthenticatedSession,
};
