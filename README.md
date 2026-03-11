# leetcode-streak-guardian

LeetCode Streak Guardian runs on a schedule and protects streaks by checking daily submissions, sending progressive reminders, and attempting an emergency auto-submit after 2 AM IST.

## Core Architecture

```text
GitHub Action (every 10 min)
  -> check submissions (GraphQL recentSubmissionList)
  -> submitted today? yes -> exit
  -> no -> reminder engine
  -> after 2 AM IST -> playwright submit
```

## Project Structure

```text
src/
  index.js
  config.js
  leetcodeApi.js
  reminderEngine.js
  playwrightSubmit.js
  telegramNotifier.js
scripts/
  generateSession.js
```

## Authentication Setup (Session Only)

This project never performs automated email/password login in CI.
Authentication uses `LEETCODE_STORAGE_STATE` only.

1. Generate session locally:

```bash
npm run generate:session
```

Login manually in the opened browser, then press Enter in terminal.
This creates `session.json`.

2. Add GitHub Secret:

- Settings -> Secrets and variables -> Actions
- Secret name: `LEETCODE_STORAGE_STATE`
- Value: full contents of `session.json`

3. Runtime behavior:

- If session missing/invalid/expired -> one Telegram alert per day, automation stops for the run.
- No login retries, no credential form automation.

## Environment Variables

Required:

- `LEETCODE_USERNAME`
- `LEETCODE_STORAGE_STATE`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Optional:

- `CHECK_INTERVAL` (default `10`)
- `USE_INTERNAL_CRON` (default `false`)
- `AUTO_SUBMIT_RETRY_MINUTES` (default `15`)
- `LOCK_STALE_MINUTES` (default `25`)

## Reminder Schedule (IST)

- Before 8 PM: no reminders
- 8 PM to 10 PM: every hour
- 10 PM to 1 AM: every 30 minutes
- 1 AM to 2 AM: every 5 minutes
- 2 AM onward: emergency stage + auto-submit attempts

## Dynamic Problem Selection

Auto-submit does not use a fixed hardcoded problem only.
It fetches `recentSubmissionList` and selects the latest `titleSlug`:

- if latest submission exists: `https://leetcode.com/problems/<titleSlug>/`
- if unavailable: fallback to `https://leetcode.com/problems/two-sum/`

## Submit Reliability

Playwright auto-submit flow:

1. Launch browser with session storage state
2. Open selected problem page
3. Wait for editor (`.monaco-editor`, `[data-cy=\"code-area\"]`, `textarea`)
4. Find submit button using fallback selectors:
   - `[data-e2e-locator=\"console-submit-button\"]`
   - `[data-cy=\"submit-code-btn\"]`
   - `button:has-text(\"Submit\")`
   - `button:has-text(\"Submit Code\")`
5. Ensure button is visible and enabled, scroll into view, apply human-like delay
6. Click submit and detect result via network (`POST /submit/`) or verdict text

## GitHub Actions

Workflow should pass only:

- `LEETCODE_USERNAME`
- `LEETCODE_STORAGE_STATE`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

## Commands

Install and run once:

```bash
npm install
npm run install:browsers
npm start
```

Generate session:

```bash
npm run generate:session
```
