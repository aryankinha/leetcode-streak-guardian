const assert = require('assert');
const fs = require('fs');
const config = require('../src/config');
const reminderEngine = require('../src/reminderEngine');
const leetcodeApi = require('../src/leetcodeApi');

const { WINDOW } = reminderEngine;

function at(hour, minute) {
  return hour * 60 + minute;
}

async function runTests() {
  console.log('====================================================');
  console.log('      LeetCode Streak Guardian — Test Suite          ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  const backupState = fs.existsSync(config.paths.runtimeState)
    ? fs.readFileSync(config.paths.runtimeState, 'utf-8')
    : null;
  const backupMeta = fs.existsSync(config.paths.sessionMeta)
    ? fs.readFileSync(config.paths.sessionMeta, 'utf-8')
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
  }

  function writeState(overrides = {}) {
    const base = {
      streakDay: '2026-11-13',
      firstReminderSentDay: null,
      lastAlertTime: 0,
      pendingAlertDay: null,
      safeNotifiedDay: null,
      lastErrorAlertTime: 0,
    };

    fs.writeFileSync(
      config.paths.runtimeState,
      JSON.stringify({ ...base, ...overrides }, null, 2),
      'utf-8'
    );
  }

  function collector() {
    const messages = [];
    return {
      messages,
      send: async (message) => {
        messages.push(message);
        return true;
      },
    };
  }

  function test(name, fn) {
    try {
      fn();
      console.log(`  PASS: ${name}`);
      passed += 1;
    } catch (error) {
      console.error(`  FAIL: ${name}`);
      console.error(`        ${error.stack || error.message}`);
      failed += 1;
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`  PASS: ${name}`);
      passed += 1;
    } catch (error) {
      console.error(`  FAIL: ${name}`);
      console.error(`        ${error.stack || error.message}`);
      failed += 1;
    }
  }

  try {
    console.log('--- Configuration ---');
    test('runtime and logs directories exist', () => {
      assert(fs.existsSync(config.paths.runtimeDir), 'runtime directory is missing');
      assert(fs.existsSync(config.paths.logsDir), 'logs directory is missing');
    });

    test('config exposes the expected state paths', () => {
      assert(config.paths.runtimeState.endsWith('state.json'));
      assert(config.paths.sessionMeta.endsWith('session-meta.json'));
    });

    test('check interval is clamped to a valid cron range', () => {
      assert(config.checkInterval >= 1 && config.checkInterval <= 59);
    });

    console.log('\n--- IST time and reminder windows ---');
    test('getISTParts converts UTC to IST', () => {
      const parts = reminderEngine.getISTParts(new Date('2026-11-13T12:30:00Z'));
      assert.strictEqual(parts.hour, 18);
      assert.strictEqual(parts.minute, 0);
      assert.strictEqual(parts.istDateStr, '2026-11-13');
      assert.strictEqual(parts.totalMinutesFromMidnight, at(18, 0));
    });

    test('midnight is hour 0, not hour 24', () => {
      const parts = reminderEngine.getISTParts(new Date('2026-11-13T18:30:00Z'));
      assert.strictEqual(parts.hour, 0);
      assert.strictEqual(parts.istDateStr, '2026-11-14');
    });

    test('streak day follows the UTC date', () => {
      assert.strictEqual(
        reminderEngine.getLeetCodeStreakDay(new Date('2026-11-13T20:30:00Z')),
        '2026-11-13'
      );
      assert.strictEqual(
        reminderEngine.getLeetCodeStreakDay(new Date('2026-11-14T00:30:00Z')),
        '2026-11-14'
      );
    });

    test('reminder window boundaries are correct', () => {
      assert.strictEqual(reminderEngine.getReminderWindow(at(17, 59)), WINDOW.QUIET);
      assert.strictEqual(reminderEngine.getReminderWindow(at(18, 0)), WINDOW.EVENING);
      assert.strictEqual(reminderEngine.getReminderWindow(at(19, 59)), WINDOW.EVENING);
      assert.strictEqual(reminderEngine.getReminderWindow(at(20, 0)), WINDOW.LATE_EVENING);
      assert.strictEqual(reminderEngine.getReminderWindow(at(21, 59)), WINDOW.LATE_EVENING);
      assert.strictEqual(reminderEngine.getReminderWindow(at(22, 0)), WINDOW.URGENT);
      assert.strictEqual(reminderEngine.getReminderWindow(at(0, 0)), WINDOW.URGENT);
      assert.strictEqual(reminderEngine.getReminderWindow(at(0, 59)), WINDOW.URGENT);
      assert.strictEqual(reminderEngine.getReminderWindow(at(1, 0)), WINDOW.CRITICAL);
      assert.strictEqual(reminderEngine.getReminderWindow(at(5, 29)), WINDOW.CRITICAL);
      assert.strictEqual(reminderEngine.getReminderWindow(at(5, 30)), WINDOW.QUIET);
      assert.strictEqual(reminderEngine.getReminderWindow(at(12, 0)), WINDOW.QUIET);
    });

    test('reminder intervals match the schedule', () => {
      assert.strictEqual(reminderEngine.getReminderIntervalMinutes(WINDOW.EVENING), null);
      assert.strictEqual(reminderEngine.getReminderIntervalMinutes(WINDOW.LATE_EVENING), 30);
      assert.strictEqual(reminderEngine.getReminderIntervalMinutes(WINDOW.URGENT), 15);
      assert.strictEqual(reminderEngine.getReminderIntervalMinutes(WINDOW.CRITICAL), 10);
      assert.strictEqual(reminderEngine.getReminderIntervalMinutes(WINDOW.QUIET), null);
    });

    test('minutes until reset are correct', () => {
      const parts = (iso) => reminderEngine.getISTParts(new Date(iso));
      assert.strictEqual(reminderEngine.getMinutesUntilReset(parts('2026-11-13T12:30:00Z')), 690);
      assert.strictEqual(reminderEngine.getMinutesUntilReset(parts('2026-11-13T17:30:00Z')), 390);
      assert.strictEqual(reminderEngine.getMinutesUntilReset(parts('2026-11-13T20:30:00Z')), 210);
      assert.strictEqual(reminderEngine.getMinutesUntilReset(parts('2026-11-13T23:50:00Z')), 10);
    });

    test('duration formatting is readable', () => {
      assert.strictEqual(reminderEngine.formatDuration(690), '11h 30m');
      assert.strictEqual(reminderEngine.formatDuration(165), '2h 45m');
      assert.strictEqual(reminderEngine.formatDuration(10), '10m');
    });

    test('12-hour IST formatting is correct', () => {
      const morning = reminderEngine.getISTParts(new Date('2026-11-13T18:30:00Z'));
      const evening = reminderEngine.getISTParts(new Date('2026-11-13T12:30:00Z'));
      assert.strictEqual(reminderEngine.formatIstTime(morning), '12:00 AM IST');
      assert.strictEqual(reminderEngine.formatIstTime(evening), '6:00 PM IST');
    });

    console.log('\n--- Message content ---');
    test('messages are plain text, status-first, and have no markdown', () => {
      const ist = reminderEngine.getISTParts(new Date('2026-11-13T12:30:00Z'));
      const evening = reminderEngine.buildReminderMessage({
        window: WINDOW.EVENING,
        ist,
        dcc: { title: 'Two Sum', difficulty: 'Easy', link: 'https://leetcode.com/problems/two-sum/' },
      });

      assert(evening.includes("Today's LeetCode streak is pending"));
      assert(evening.includes('Two Sum'));
      assert(evening.includes('Reset: 5:30 AM IST'));

      for (const window of [WINDOW.EVENING, WINDOW.LATE_EVENING, WINDOW.URGENT, WINDOW.CRITICAL]) {
        const message = reminderEngine.buildReminderMessage({ window, ist, dcc: null });
        assert(!message.includes('*'), `${window} message contains markdown asterisks`);
      }
    });

    test('critical message shows the final-hours warning', () => {
      const ist = reminderEngine.getISTParts(new Date('2026-11-13T21:15:00Z')); // 02:45 IST
      const message = reminderEngine.buildReminderMessage({ window: WINDOW.CRITICAL, ist });
      assert(message.includes('Final hours'));
      assert(message.includes('Reset in 2h 45m'));
      assert(message.includes('Solve any problem before 5:30 AM IST.'));
    });

    console.log('\n--- State handling ---');
    test('a new streak day resets reminder state and drops old auto-submit fields', () => {
      writeState({
        streakDay: '2026-11-12',
        firstReminderSentDay: '2026-11-12',
        lastAlertTime: 12345,
        pendingAlertDay: '2026-11-12',
        autoSubmit: { attemptCount: 3, succeeded: true },
        autoSubmitJitterMinutes: 150,
      });

      const state = reminderEngine.loadState(new Date('2026-11-13T12:30:00Z'));
      assert.strictEqual(state.streakDay, '2026-11-13');
      assert.strictEqual(state.firstReminderSentDay, null);
      assert.strictEqual(state.lastAlertTime, 0);
      assert.strictEqual(state.pendingAlertDay, null);
      assert.strictEqual(state.autoSubmit, undefined);
      assert.strictEqual(state.autoSubmitJitterMinutes, undefined);
    });

    test('same-day state keeps counters and drops old auto-submit fields', () => {
      writeState({
        streakDay: '2026-11-13',
        lastAlertTime: 12345,
        autoSubmit: { attemptCount: 3 },
        autoSubmitJitterMinutes: 150,
      });

      const state = reminderEngine.loadState(new Date('2026-11-13T12:30:00Z'));
      assert.strictEqual(state.lastAlertTime, 12345);
      assert.strictEqual(state.autoSubmit, undefined);
      assert.strictEqual(state.autoSubmitJitterMinutes, undefined);
    });

    console.log('\n--- Reminder gating ---');
    await testAsync('evening reminder sends once per day and includes the challenge', async () => {
      writeState();
      const { messages, send } = collector();
      const fetchDcc = async () => ({
        title: 'Two Sum',
        difficulty: 'Easy',
        link: 'https://leetcode.com/problems/two-sum/',
      });

      const first = await reminderEngine.processReminders({
        now: new Date('2026-11-13T12:30:00Z'),
        send,
        fetchDcc,
      });

      assert.strictEqual(first.sent, true);
      assert.strictEqual(first.window, WINDOW.EVENING);
      assert(messages[0].includes("Today's LeetCode streak is pending"));
      assert(messages[0].includes('Two Sum'));

      const second = await reminderEngine.processReminders({
        now: new Date('2026-11-13T12:40:00Z'),
        send,
        fetchDcc,
      });

      assert.strictEqual(second.sent, false);
      assert.strictEqual(messages.length, 1);
    });

    await testAsync('late-evening reminders respect the 30-minute interval', async () => {
      writeState({
        firstReminderSentDay: '2026-11-13',
        lastAlertTime: new Date('2026-11-13T14:30:00Z').getTime(),
      });
      const { messages, send } = collector();

      const early = await reminderEngine.processReminders({
        now: new Date('2026-11-13T14:40:00Z'),
        send,
      });
      assert.strictEqual(early.sent, false);

      const later = await reminderEngine.processReminders({
        now: new Date('2026-11-13T15:01:00Z'),
        send,
      });
      assert.strictEqual(later.sent, true);
      assert.strictEqual(later.window, WINDOW.LATE_EVENING);
      assert.strictEqual(messages.length, 1);
    });

    await testAsync('critical reminders respect the 10-minute interval', async () => {
      writeState({
        firstReminderSentDay: '2026-11-13',
        lastAlertTime: new Date('2026-11-13T19:30:00Z').getTime(),
      });
      const { messages, send } = collector();

      const early = await reminderEngine.processReminders({
        now: new Date('2026-11-13T19:35:00Z'),
        send,
      });
      assert.strictEqual(early.sent, false);

      const later = await reminderEngine.processReminders({
        now: new Date('2026-11-13T19:41:00Z'),
        send,
      });
      assert.strictEqual(later.sent, true);
      assert.strictEqual(later.window, WINDOW.CRITICAL);
      assert.strictEqual(messages.length, 1);
      assert(messages[0].includes('Final hours'));
    });

    await testAsync('quiet hours send nothing', async () => {
      writeState();
      const { messages, send } = collector();

      const result = await reminderEngine.processReminders({
        now: new Date('2026-11-13T06:30:00Z'), // 12:00 IST
        send,
      });

      assert.strictEqual(result.sent, false);
      assert.strictEqual(result.window, WINDOW.QUIET);
      assert.strictEqual(messages.length, 0);
    });

    await testAsync('a failed Telegram send does not advance state', async () => {
      writeState();
      const now = new Date('2026-11-13T16:30:00Z'); // 22:00 IST

      const result = await reminderEngine.processReminders({
        now,
        send: async () => false,
      });

      assert.strictEqual(result.sent, false);

      const state = reminderEngine.loadState(now);
      assert.strictEqual(state.lastAlertTime, 0);
      assert.strictEqual(state.pendingAlertDay, null);
    });

    console.log('\n--- LeetCode API helpers ---');
    test('streak reset timestamp is 00:00 UTC', () => {
      const timestamp = leetcodeApi.getStreakResetTimestamp(new Date('2026-11-13T12:00:00Z'));
      const expected = Math.floor(new Date('2026-11-13T00:00:00Z').getTime() / 1000);
      assert.strictEqual(timestamp, expected);
    });

    test('resolveUsername ignores placeholders and uses session metadata', () => {
      const originalUsername = config.leetcode.username;
      const originalMeta = fs.existsSync(config.paths.sessionMeta)
        ? fs.readFileSync(config.paths.sessionMeta, 'utf-8')
        : null;

      try {
        config.leetcode.username = 'your_username';
        if (fs.existsSync(config.paths.sessionMeta)) fs.unlinkSync(config.paths.sessionMeta);
        assert.strictEqual(leetcodeApi.resolveUsername(), null);

        fs.writeFileSync(
          config.paths.sessionMeta,
          JSON.stringify({ username: 'valid_user_meta' }),
          'utf-8'
        );
        assert.strictEqual(leetcodeApi.resolveUsername(), 'valid_user_meta');
      } finally {
        config.leetcode.username = originalUsername;
        if (originalMeta !== null) {
          fs.writeFileSync(config.paths.sessionMeta, originalMeta, 'utf-8');
        } else if (fs.existsSync(config.paths.sessionMeta)) {
          fs.unlinkSync(config.paths.sessionMeta);
        }
      }
    });

    await testAsync('checkSubmissionsToday returns ERROR when the username is missing', async () => {
      const originalUsername = config.leetcode.username;
      const originalMeta = fs.existsSync(config.paths.sessionMeta)
        ? fs.readFileSync(config.paths.sessionMeta, 'utf-8')
        : null;

      try {
        config.leetcode.username = undefined;
        if (fs.existsSync(config.paths.sessionMeta)) fs.unlinkSync(config.paths.sessionMeta);

        const result = await leetcodeApi.checkSubmissionsToday();
        assert.strictEqual(result.status, 'ERROR');
        assert(result.message.includes('LEETCODE_USERNAME'));
      } finally {
        config.leetcode.username = originalUsername;
        if (originalMeta !== null) {
          fs.writeFileSync(config.paths.sessionMeta, originalMeta, 'utf-8');
        } else if (fs.existsSync(config.paths.sessionMeta)) {
          fs.unlinkSync(config.paths.sessionMeta);
        }
      }
    });
  } finally {
    restoreBackups();
    console.log('\n[INFO] Runtime files restored to their pre-test state.');
  }

  console.log('\n====================================================');
  console.log(`Test Summary: ${passed} passed, ${failed} failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
