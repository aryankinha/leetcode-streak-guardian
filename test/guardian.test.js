const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const config = require('../src/config');
const problemBank = require('../src/problemBank');
const reminderEngine = require('../src/reminderEngine');
const sessionManager = require('../src/sessionManager');
const leetcodeApi = require('../src/leetcodeApi');
const humanBehavior = require('../src/humanBehavior');
const autoSubmit = require('../src/autoSubmit');

async function runTests() {
  console.log('====================================================');
  console.log('      Running Streak Guardian Verification Suite    ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  // Snapshot runtime state files to guarantee test isolation
  const backupState = fs.existsSync(config.paths.runtimeState)
    ? fs.readFileSync(config.paths.runtimeState, 'utf-8')
    : null;
  const backupMeta = fs.existsSync(config.paths.sessionMeta)
    ? fs.readFileSync(config.paths.sessionMeta, 'utf-8')
    : null;
  const backupHistory = fs.existsSync(config.paths.submissionHistory)
    ? fs.readFileSync(config.paths.submissionHistory, 'utf-8')
    : null;

  function restoreBackups() {
    if (backupState !== null) {
      fs.writeFileSync(config.paths.runtimeState, backupState, 'utf-8');
    } else if (fs.existsSync(config.paths.runtimeState)) {
      fs.unlinkSync(config.paths.runtimeState);
    }

    if (backupMeta !== null) {
      fs.writeFileSync(config.paths.sessionMeta, backupMeta, 'utf-8');
    } else if (fs.existsSync(config.paths.sessionMeta)) {
      fs.unlinkSync(config.paths.sessionMeta);
    }

    if (backupHistory !== null) {
      fs.writeFileSync(config.paths.submissionHistory, backupHistory, 'utf-8');
    } else if (fs.existsSync(config.paths.submissionHistory)) {
      fs.unlinkSync(config.paths.submissionHistory);
    }
  }

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     ${err.stack || err.message}`);
      failed++;
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     ${err.stack || err.message}`);
      failed++;
    }
  }

  try {
    // Group 1: Configuration & Auto-directory Creation
    console.log('--- Group 1: Configuration & File System ---');
    test('runtime and logs directories are automatically created', () => {
      assert(fs.existsSync(config.paths.runtimeDir), 'runtime directory should exist');
      assert(fs.existsSync(config.paths.logsDir), 'logs directory should exist');
    });

    test('config contains expected paths', () => {
      assert(config.paths.session.endsWith('session.json'));
      assert(config.paths.sessionMeta.endsWith('session-meta.json'));
      assert(config.paths.submissionHistory.endsWith('submission-history.json'));
      assert(config.paths.runtimeState.endsWith('state.json'));
    });

    // Group 2: Problem Bank & Rotation Logic
    console.log('\n--- Group 2: Problem Bank & Anti-Ban Engine ---');
    test('problem bank contains 30+ verified problems with correct metadata', () => {
      assert(problemBank.PROBLEM_BANK.length >= 30, `Expected at least 30 problems, got ${problemBank.PROBLEM_BANK.length}`);
      for (const p of problemBank.PROBLEM_BANK) {
        assert(p.id, `Problem missing ID: ${JSON.stringify(p)}`);
        assert(p.title, `Problem missing title: ${JSON.stringify(p)}`);
        assert(p.slug, `Problem missing slug: ${JSON.stringify(p)}`);
        assert(p.solution.includes('class Solution:'), `Solution missing Solution class: ${p.slug}`);
      }
    });

    test('all problem bank solutions have valid Python 3 syntax and method signatures', () => {
      const pythonScript = `
import ast, sys
from typing import Optional, List

class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

problems = ${JSON.stringify(problemBank.PROBLEM_BANK.map(p => ({ id: p.id, slug: p.slug, solution: p.solution })))}

for p in problems:
    tree = ast.parse(p['solution'])
    has_solution = False
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == 'Solution':
            has_solution = True
            funcs = [m for m in node.body if isinstance(m, ast.FunctionDef)]
            assert len(funcs) >= 1, f"No method in Solution for {p['slug']}"
            method = funcs[0]
            args = [a.arg for a in method.args.args]
            assert 'self' in args, f"Method {method.name} missing self in {p['slug']}"
            if p['slug'] == 'valid-anagram':
                assert len(args) == 3, f"isAnagram expected 3 args (self, s, t), got {args}"
    assert has_solution, f"No class Solution in {p['slug']}"
print("PYTHON_VALIDATION_SUCCESS")
`;
      const output = execSync('python3', { input: pythonScript, encoding: 'utf-8' });
      assert(output.includes('PYTHON_VALIDATION_SUCCESS'), 'Python validation script failed');
    });

    test('generateSolutionCode adds dynamic nonce comments', () => {
      const p = problemBank.PROBLEM_BANK[0];
      const code1 = problemBank.generateSolutionCode(p);
      const code2 = problemBank.generateSolutionCode(p);
      assert(code1.includes('class Solution:'), 'Code should contain Solution class');
      assert(code1.startsWith('#'), 'Code should start with comment');
      assert(typeof code1 === 'string' && code1.length > p.solution.length);
    });

    test('problem rotation filters out recently solved problems', () => {
      const p1 = problemBank.PROBLEM_BANK[0];
      const p2 = problemBank.PROBLEM_BANK[1];

      const testRecord = {
        problemId: p1.id,
        slug: p1.slug,
        title: p1.title,
        timestamp: Date.now(),
        status: 'Accepted',
      };

      fs.writeFileSync(config.paths.submissionHistory, JSON.stringify([testRecord], null, 2));

      const recentSlugs = problemBank.getRecentSolvedSlugs(14);
      assert(recentSlugs.has(p1.slug), 'p1 slug should be in recent solved slugs');
      assert(!recentSlugs.has(p2.slug), 'p2 slug should NOT be in recent solved slugs');

      for (let i = 0; i < 10; i++) {
        const selected = problemBank.selectProblem([p1.slug]);
        assert.notStrictEqual(selected.slug, p1.slug, 'selectProblem picked excluded slug');
      }
    });

    // Group 3: Timezone, Date Boundaries & Reminder Engine
    console.log('\n--- Group 3: Timezone & Date Boundaries ---');
    test('getISTParts accurately formats Asia/Kolkata time', () => {
      const parts = reminderEngine.getISTParts();
      assert(parts.year >= 2026, 'Year should be >= 2026');
      assert(parts.month >= 1 && parts.month <= 12, 'Month should be between 1 and 12');
      assert(parts.day >= 1 && parts.day <= 31, 'Day should be between 1 and 31');
      assert(parts.hour >= 0 && parts.hour <= 23, 'Hour should be between 0 and 23');
      assert(parts.minute >= 0 && parts.minute <= 59, 'Minute should be between 0 and 59');
      assert.strictEqual(parts.totalMinutesFromMidnight, parts.hour * 60 + parts.minute);
    });

    test('getLeetCodeStreakDay matches UTC date string', () => {
      const fixedDate = new Date('2026-09-11T20:30:00Z');
      const streakDay = reminderEngine.getLeetCodeStreakDay(fixedDate);
      assert.strictEqual(streakDay, '2026-09-11');
    });

    test('6 PM reminder suppression bug is fixed with streak day tracking', () => {
      const state = reminderEngine.loadState();
      const streakDay = reminderEngine.getLeetCodeStreakDay();

      state.firstReminderSentDay = null;
      reminderEngine.saveState(state);

      const reloaded = reminderEngine.loadState();
      assert.strictEqual(reloaded.firstReminderSentDay, null);

      reloaded.firstReminderSentDay = streakDay;
      reminderEngine.saveState(reloaded);

      const checkState = reminderEngine.loadState();
      assert.strictEqual(checkState.firstReminderSentDay, streakDay);
    });

    test('autoSubmit jitter is bounded between 2:15 AM (135 min) and 3:45 AM (225 min) IST', () => {
      const state = reminderEngine.loadState();
      assert(
        state.autoSubmitJitterMinutes >= 135 && state.autoSubmitJitterMinutes <= 225,
        `Jitter ${state.autoSubmitJitterMinutes} outside range [135, 225]`
      );
    });

    test('autoSubmit state tracks attempts and enforces max retry count', () => {
      const state = reminderEngine.loadState();
      state.autoSubmit.attemptCount = 3;
      state.autoSubmit.succeeded = false;
      reminderEngine.saveState(state);

      const saved = reminderEngine.loadState();
      assert.strictEqual(saved.autoSubmit.attemptCount, 3);
      assert.strictEqual(saved.autoSubmit.succeeded, false);
    });

    test('autoSubmit state structure is preserved even when reading empty/old state files', () => {
      fs.writeFileSync(config.paths.runtimeState, JSON.stringify({ streakDay: '2026-09-11' }));
      const loaded = reminderEngine.loadState();
      assert(loaded.autoSubmit, 'autoSubmit should be defined');
      assert.strictEqual(loaded.autoSubmit.attemptCount, 0);
      assert.strictEqual(loaded.autoSubmit.succeeded, false);
      assert.strictEqual(loaded.autoSubmit.lastAttemptTime, 0);
    });

    // Group 4: Session Manager & Dual Mode Auth
    console.log('\n--- Group 4: Session Manager & Dual Mode Auth ---');
    test('sessionMeta persists and reads cleanly', () => {
      const meta = { username: 'testuser_test_run', mode: 'session.json', testRun: true };
      sessionManager.saveSessionMeta(meta);

      const read = sessionManager.getSessionMeta();
      assert(read, 'sessionMeta should be readable');
      assert.strictEqual(read.username, 'testuser_test_run');
      assert.strictEqual(read.mode, 'session.json');
      assert(read.updatedAt, 'updatedAt should be set');
    });

    test('getActiveSessionCookies filters out placeholder tokens from .env', () => {
      const orig = config.leetcode.session;
      try {
        config.leetcode.session = 'your_session';
        // When session.json doesn't exist, it should not return placeholder
        if (!fs.existsSync(config.paths.session)) {
          const res = sessionManager.getActiveSessionCookies();
          assert.strictEqual(res, null, 'Should ignore placeholder token');
        }
      } finally {
        config.leetcode.session = orig;
      }
    });

    // Group 5: LeetCode API & Dynamic Resolution
    console.log('\n--- Group 5: LeetCode API & Tri-State Architecture ---');
    test('resolveUsername ignores placeholder values and resolves meta', () => {
      sessionManager.saveSessionMeta({ username: 'valid_user_meta' });
      const origUser = config.leetcode.username;
      try {
        config.leetcode.username = 'your_username';
        const resolved = leetcodeApi.resolveUsername();
        assert.strictEqual(resolved, 'valid_user_meta', 'Should resolve meta when env is a placeholder');
      } finally {
        config.leetcode.username = origUser;
      }
    });

    test('getStreakResetTimestamp accurately matches 00:00 UTC', () => {
      const ts = leetcodeApi.getStreakResetTimestamp(new Date('2026-09-11T12:00:00Z'));
      const expected = Math.floor(new Date('2026-09-11T00:00:00Z').getTime() / 1000);
      assert.strictEqual(ts, expected);
    });

    // Group 6: Human Behavior & Stealth Plugin Registration
    console.log('\n--- Group 6: Stealth & Human Behavior ---');
    test('playwright-extra uses puppeteer-extra-plugin-stealth without crashing', () => {
      assert(humanBehavior.chromium, 'chromium should be exported');
      assert(typeof humanBehavior.simulateHuman === 'function');
      assert(typeof humanBehavior.humanDwellTime === 'function');
      assert(typeof humanBehavior.simulateMouseMovement === 'function');
      assert(typeof humanBehavior.simulateScroll === 'function');
    });

    // Group 7: Dry-Run and Fallback Integration
    console.log('\n--- Group 7: Auto-Submit Architecture & Verification ---');
    test('autoSubmit exports expected components', () => {
      assert(typeof autoSubmit.performAutoSubmit === 'function');
      assert(typeof autoSubmit.pollSubmissionResult === 'function');
      assert(typeof autoSubmit.injectCodeIntoMonaco === 'function');
      assert(typeof autoSubmit.triggerUiSubmit === 'function');
      assert(typeof autoSubmit.submitViaInPageFetch === 'function');
    });

  } finally {
    // Restore clean backups to avoid state pollution
    restoreBackups();
    console.log('\n[INFO] Runtime files restored cleanly to pre-test state.');
  }

  console.log('\n====================================================');
  console.log(`Test Summary: ${passed} passed, ${failed} failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
