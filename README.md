# LeetCode Streak Guardian

Checks your LeetCode submissions every 10 minutes from morning to just before the streak reset, then sends short Telegram reminders until you solve a problem. No auto-submit.

## How it works

```text
GitHub Actions (every 10 min, 9:30 AM - 5:20 AM IST)
  -> check recent accepted submissions
  -> solved? exit
  -> not solved? send the next reminder for the current time window
```

LeetCode resets the daily streak at **05:30 AM IST** (00:00 UTC). The bot stops reminding after that.

## Reminder schedule (IST)

| Time | Behaviour |
| --- | --- |
| 9:30 AM - 5:30 PM | Every 60 minutes |
| 5:30 PM - 6:00 PM | Quiet |
| 6:00 PM - 8:00 PM | One reminder, with today's daily challenge link |
| 8:00 PM - 10:00 PM | Every 30 minutes |
| 10:00 PM - 1:00 AM | Every 15 minutes |
| 1:00 AM - 5:30 AM | Every 10 minutes |
| 5:30 AM - 9:30 AM | Quiet |

A "streak safe" message is sent once if you solve after receiving a reminder.

## Message format

Messages are plain text and contain only the current status, time, and reset countdown. Morning reminders start with a greeting, and reminders address you once as "sir". Examples:

```text
Good morning, sir,
📌 Today's LeetCode streak is pending
No accepted submission today.
Time: 9:30 AM IST | Reset in 20h 00m
```

```text
📌 Today's LeetCode streak is pending
No accepted submission today, sir.
Time: 6:15 PM IST | Reset: 5:30 AM IST (in 11h 15m)
Challenge: Climbing Stairs II (Medium)
https://leetcode.com/problems/climbing-stairs-ii/
```

## Setup

### 1. Install

```bash
npm ci --omit=dev
```

The reminder bot only needs `axios`, `dotenv`, and `node-cron`. Playwright is a dev dependency used by the optional local auto-submit scripts.

### 2. Local environment

Copy `.env.example` to `.env` and set:

```env
LEETCODE_USERNAME=your_leetcode_username
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id
```

### 3. GitHub Actions secrets

In the repository, go to **Settings -> Secrets and variables -> Actions** and add:

- `LEETCODE_USERNAME` (repository variable or secret)
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

No LeetCode session or password is needed for reminders.

### 4. Run

```bash
npm start      # local scheduler, every 10 minutes
npm run once   # one cycle only
npm test       # test suite
```

## GitHub Actions

The workflow runs `*/10 4-23 * * *` UTC, which is **9:30 AM to 5:20 AM IST** — the full reminder window, with no wasted runs overnight. Frequent runs also survive GitHub's scheduled-job delays.

You can trigger a test message manually:

```bash
gh workflow run guardian.yml -f test_alert=true
```

### Keep the workflow enabled

GitHub disables scheduled workflows in public repositories after **60 days without a push**. Push any commit at least once every two months, or move the scheduler to a small always-on host if you want zero maintenance.

## State

Reminder state is stored in `runtime/state.json` and restored between GitHub Actions runs with the Actions cache. It contains only reminder timestamps; no credentials are cached.

## Optional: manual auto-submit scripts

The auto-submit code is still in the repository for local experimentation, but it is **not** part of the scheduled flow. To use it locally:

```bash
npm install          # installs dev dependencies, including Playwright
npx playwright install chromium
npm run login
npm run test-submit -- --dry-run
```

## Project structure

```text
src/
  index.js           local cron entry point
  runOnce.js         GitHub Actions / one-shot entry point
  guardian.js        check submissions + decide whether to notify
  reminderEngine.js  IST windows, state, message text
  leetcodeApi.js     LeetCode GraphQL client
  telegramNotifier.js
  config.js
  logger.js
test/
  guardian.test.js
```
