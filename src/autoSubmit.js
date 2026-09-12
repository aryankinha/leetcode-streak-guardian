const fs = require('fs');
const config = require('./config');
const { ensureAuthenticatedSession } = require('./sessionManager');
const {
  selectProblem,
  generateSolutionCode,
  recordSubmission,
  PROBLEM_BANK,
} = require('./problemBank');
const {
  randomDelay,
  simulateHuman,
  humanDwellTime,
} = require('./humanBehavior');
const { sendMessage } = require('./telegramNotifier');

/**
 * Polls LeetCode submission status until completion or timeout.
 */
async function pollSubmissionResult(page, submissionId, maxWaitMs = 35000) {
  const startTime = Date.now();
  console.log(`[INFO] Polling verdict for submission ${submissionId}...`);

  while (Date.now() - startTime < maxWaitMs) {
    await randomDelay(1800, 2500);

    const check = await page.evaluate(async (subId) => {
      try {
        const res = await fetch(`/submissions/detail/${subId}/check/`);
        if (!res.ok) return { state: 'ERROR', error: `HTTP ${res.status}` };
        return await res.json();
      } catch (e) {
        return { state: 'ERROR', error: e.message };
      }
    }, submissionId);

    if (!check) continue;

    console.log(`[INFO] Submission ${submissionId} state: ${check.state}, status: ${check.status_msg || 'checking...'}`);

    if (check.state === 'SUCCESS') {
      return check;
    }

    if (check.state === 'FAILURE') {
      return check;
    }
  }

  return { state: 'TIMEOUT', status_msg: 'Verdict poll timed out' };
}

/**
 * Ensures Python 3 language is active on the problem page.
 */
async function ensurePython3Language(page) {
  try {
    await page.evaluate(() => {
      try {
        localStorage.setItem('global_lang', 'python3');
        localStorage.setItem('dynamic_lang', 'python3');
      } catch (e) {}
    });

    const langBtn = page.locator('button[id*="headlessui-listbox-button"], button:has-text("C++"), button:has-text("Java"), button:has-text("JavaScript"), button:has-text("TypeScript"), button:has-text("C#"), button:has-text("Go"), button:has-text("Rust")').first();
    if (await langBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      const text = (await langBtn.innerText().catch(() => '')).trim();
      if (text && !text.toLowerCase().includes('python')) {
        console.log(`[INFO] Current editor language appears to be "${text}". Switching to Python3...`);
        await langBtn.click().catch(() => {});
        await randomDelay(300, 600);
        const pyOption = page.locator('div[role="option"]:has-text("Python3"), li:has-text("Python3"), [role="menuitem"]:has-text("Python3"), text="Python3"').first();
        if (await pyOption.isVisible({ timeout: 1500 }).catch(() => false)) {
          await pyOption.click().catch(() => {});
          await randomDelay(500, 1000);
          console.log('[INFO] Successfully selected Python3 in UI.');
        }
      }
    }
  } catch (err) {
    // Non-fatal
  }
}

/**
 * Injects solution code into the Monaco Editor model with polling.
 */
async function injectCodeIntoMonaco(page, code, maxWaitMs = 12000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const result = await page.evaluate((solutionCode) => {
      try {
        if (window.monaco && window.monaco.editor) {
          const models = window.monaco.editor.getModels();
          if (models && models.length > 0) {
            const pyModel = models.find(m => m.getModeId && m.getModeId() === 'python') || models[0];
            if (window.monaco.editor.setModelLanguage && pyModel.getModeId && pyModel.getModeId() !== 'python') {
              try {
                window.monaco.editor.setModelLanguage(pyModel, 'python');
              } catch (e) {}
            }
            pyModel.setValue(solutionCode);
            return { success: true, method: 'monaco.editor.getModels' };
          }
        }
        return { success: false, reason: 'Monaco models not available yet' };
      } catch (e) {
        return { success: false, reason: e.message };
      }
    }, code);

    if (result.success) return result;
    await new Promise((r) => setTimeout(r, 800));
  }

  return { success: false, reason: 'Monaco models timed out' };
}

/**
 * Triggers submission via UI submit button or keyboard shortcut Ctrl+Enter / Cmd+Enter.
 */
async function triggerUiSubmit(page, problemSlug) {
  const submitButtonSelector = [
    'button[data-e2e-locator="console-submit-button"]',
    'button:has-text("Submit")',
    '[data-cy="submit-code-btn"]',
  ];

  for (const selector of submitButtonSelector) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        console.log(`[INFO] Clicking submit button: ${selector}`);
        await btn.click();
        return true;
      }
    } catch (e) {
      // Selector not found, continue to next
    }
  }

  // Cross-platform keyboard submit: Cmd+Enter on Mac, Ctrl+Enter on Linux/Windows
  try {
    console.log('[INFO] Attempting keyboard submit (ControlOrMeta+Enter)...');
    await page.keyboard.press('ControlOrMeta+Enter');
    await randomDelay(300, 500);
    await page.keyboard.press('Control+Enter');
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Fallback submission directly via in-page fetch using the browser's cookies and headers.
 */
async function submitViaInPageFetch(page, problemSlug, questionId, code) {
  console.log('[INFO] Attempting submission via in-page fetch fallback...');
  return await page.evaluate(async ({ slug, qId, typedCode }) => {
    try {
      const match = document.cookie.match(/csrftoken=([^;]+)/);
      const csrf = match ? match[1] : '';

      // Try resolving accurate questionId from page window props if available
      let resolvedQId = qId;
      try {
        if (window?._nextData?.props?.pageProps?.dehydratedState?.queries) {
          const q = window._nextData.props.pageProps.dehydratedState.queries.find(x => x.state?.data?.question?.questionId);
          if (q && q.state?.data?.question?.questionId) {
            resolvedQId = q.state.data.question.questionId;
          }
        }
      } catch (e) {}

      const res = await fetch(`/problems/${slug}/submit/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrftoken': csrf,
          'Referer': `https://leetcode.com/problems/${slug}/`,
          'Origin': 'https://leetcode.com',
        },
        body: JSON.stringify({
          lang: 'python3',
          question_id: resolvedQId,
          typed_code: typedCode,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        return { error: `HTTP ${res.status}: ${text}` };
      }

      return await res.json();
    } catch (err) {
      return { error: err.message };
    }
  }, { slug: problemSlug, qId: questionId, typedCode: code });
}

/**
 * Main auto-submit workflow with problem rotation, dwell time, Monaco injection,
 * and strict verification.
 */
async function performAutoSubmit(options = {}) {
  const isDryRun = !!options.dryRun;
  const dwellMin = options.dwellMin !== undefined ? options.dwellMin : (isDryRun ? 5 : 35);
  const dwellMax = options.dwellMax !== undefined ? options.dwellMax : (isDryRun ? 10 : 65);
  const maxAttempts = options.maxAttempts || 3;

  console.log(`[INFO] Initiating auto-submit process (dryRun=${isDryRun})...`);

  // Ensure authenticated session (allows anonymous preview when in dry-run mode)
  const auth = await ensureAuthenticatedSession({
    headless: !options.headed,
    allowAnonymous: isDryRun,
  });
  if (!auth.success) {
    console.error(`[ERROR] Auto-submit aborted: ${auth.message}`);
    return { success: false, error: auth.error, message: auth.message };
  }

  const { browser, context, page, username } = auth;
  const excludedSlugs = [];

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const problem = selectProblem(excludedSlugs);
      console.log(`\n[ATTEMPT ${attempt}/${maxAttempts}] Selected problem: "${problem.title}" (slug: ${problem.slug}, id: ${problem.id})`);

      const solutionCode = generateSolutionCode(problem);
      const problemUrl = `https://leetcode.com/problems/${problem.slug}/`;

      console.log(`[INFO] Navigating to: ${problemUrl}`);
      await page.goto(problemUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await randomDelay(2000, 4000);

      // Ensure Python 3 language is active in UI
      await ensurePython3Language(page);

      // Humanized Dwell Time & Behavior Simulation
      await humanDwellTime(page, dwellMin, dwellMax);

      // Monaco Editor Code Injection
      console.log('[INFO] Injecting generated solution code into Monaco Editor...');
      const injectionResult = await injectCodeIntoMonaco(page, solutionCode);

      if (!injectionResult.success) {
        console.warn(`[WARN] Monaco direct injection failed: ${injectionResult.reason}. Trying editor click fallback...`);
        try {
          const editorArea = page.locator('.monaco-editor').first();
          if (await editorArea.isVisible({ timeout: 3000 })) {
            await editorArea.click();
            await page.keyboard.press('ControlOrMeta+A');
            await page.keyboard.press('Backspace');
            await page.keyboard.insertText(solutionCode);
            injectionResult.success = true;
          }
        } catch (err) {
          console.warn('[WARN] Editor click fallback failed:', err.message);
        }
      }

      if (isDryRun) {
        if (!injectionResult.success) {
          console.error(`[DRY-RUN] Monaco code injection failed: ${injectionResult.reason}`);
          await browser.close();
          return {
            success: false,
            dryRun: true,
            error: 'INJECTION_FAILED',
            reason: injectionResult.reason,
            problem,
          };
        }

        console.log('[DRY-RUN] Code injection verified successfully. Skipping submission trigger.');
        await browser.close();
        return {
          success: true,
          dryRun: true,
          problem,
          codePreview: solutionCode.slice(0, 100) + '...',
        };
      }

      if (!injectionResult.success) {
        console.error(`[ERROR] Code injection failed for "${problem.title}". Skipping to avoid submitting stale code.`);
        excludedSlugs.push(problem.slug);
        continue;
      }

      // Submit execution
      let submissionId = null;

      // Set up response listener for /submit/ API
      const submitPromise = page
        .waitForResponse((res) => res.url().includes('/submit/'), { timeout: 15000 })
        .then(async (res) => {
          try {
            const data = await res.json();
            return data.submission_id;
          } catch (e) {
            return null;
          }
        })
        .catch(() => null);

      // Trigger UI submit
      const uiClicked = await triggerUiSubmit(page, problem.slug);

      if (uiClicked) {
        submissionId = await submitPromise;
      }

      // If UI submit didn't catch a submission_id, try in-page fetch fallback
      if (!submissionId) {
        console.log('[WARN] UI submission did not return submission ID. Invoking in-page fetch fallback...');
        const fetchRes = await submitViaInPageFetch(page, problem.slug, problem.id, solutionCode);
        if (fetchRes && fetchRes.submission_id) {
          submissionId = fetchRes.submission_id;
        } else {
          console.error('[ERROR] In-page fetch submission failed:', fetchRes?.error || 'Unknown error');
        }
      }

      if (!submissionId) {
        console.error(`[ERROR] Could not obtain submission ID for ${problem.slug}. Retrying with alternate problem.`);
        excludedSlugs.push(problem.slug);
        continue;
      }

      // Poll verdict
      const verdict = await pollSubmissionResult(page, submissionId);

      if (verdict.status_msg === 'Accepted') {
        console.log(`\n🎉 [ACCEPTED] Problem "${problem.title}" was accepted!`);
        const runtime = verdict.status_runtime || 'N/A';
        const memory = verdict.status_memory || 'N/A';

        // Record submission in history to ensure 14-day rotation
        recordSubmission({
          problemId: problem.id,
          slug: problem.slug,
          title: problem.title,
          status: 'Accepted',
          submissionId,
        });

        // Send Telegram notification
        const tgMsg =
          `🛡️ *LeetCode Streak Guardian — Auto-Submit Succeeded!*\n\n` +
          `✅ Problem: *${problem.title}*\n` +
          `⚡ Runtime: ${runtime} | 💾 Memory: ${memory}\n` +
          `👤 User: ${username || 'Guardian'}\n\n` +
          `Your daily streak has been safely extended.`;
        await sendMessage(tgMsg);

        await browser.close();
        return {
          success: true,
          problem,
          submissionId,
          verdict,
        };
      } else {
        console.warn(`[WARN] Submission was not accepted (verdict: ${verdict.status_msg}). Retrying alternate problem...`);
        excludedSlugs.push(problem.slug);
      }
    }

    // All attempts failed
    const errorMsg = `❌ Auto-submit failed after ${maxAttempts} attempts. Please solve a problem manually immediately.`;
    console.error(`[FATAL] ${errorMsg}`);
    await sendMessage(`🚨 CRITICAL: ${errorMsg}`);
    await browser.close();
    return { success: false, error: 'MAX_ATTEMPTS_EXCEEDED' };
  } catch (err) {
    console.error('[ERROR] Exception during auto-submit:', err.message);
    await sendMessage(`🚨 Streak Guardian Auto-Submit error: ${err.message}`);
    if (browser) await browser.close().catch(() => {});
    return { success: false, error: 'EXCEPTION', message: err.message };
  }
}

module.exports = {
  performAutoSubmit,
  pollSubmissionResult,
  injectCodeIntoMonaco,
  triggerUiSubmit,
  submitViaInPageFetch,
};
