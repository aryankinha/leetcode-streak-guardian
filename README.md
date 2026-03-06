# leetcode-streak-guardian

Node.js + Playwright service that protects a LeetCode streak using submission checks, reminder escalation, and emergency auto-submit.

## Setup

```bash
cd leetcode-streak-guardian
npm install
cp .env.example .env
# Fill .env values
```

## Authentication Setup (Session Only)

This project does not perform automated login in CI.
It uses a pre-authenticated Playwright storage state from `LEETCODE_STORAGE_STATE`.

1. Generate a session locally:

```bash
npm run generate:session
```

Complete manual login in the opened browser and press Enter in terminal.
This produces `session.json` in project root.

2. Upload session to GitHub Secrets:

- Open repository `Settings -> Secrets and variables -> Actions`
- Create secret: `LEETCODE_STORAGE_STATE`
- Paste the full contents of `session.json`

3. Runtime behavior:

- GitHub Actions loads `LEETCODE_STORAGE_STATE`
- Playwright starts with that session
- If session is missing/invalid/expired, automation stops and Telegram alert is sent once per day

## Run locally

```bash
npm run install:browsers
npm start
```

By default, it runs one guardian cycle and exits (`USE_INTERNAL_CRON=false`).

## Render / GitHub Cron Settings

- Build command:

```bash
npm install && npx playwright install chromium
```

- Start command:

```bash
node src/index.js
```

- Schedule:

```cron
*/10 * * * *
```

## Reminder Schedule (IST)

- Before 8 PM: no reminders
- 8 PM to 10 PM: hourly reminders
- 10 PM to 1 AM: reminders every 30 minutes
- 1 AM to 2 AM: reminders every 5 minutes
- 2 AM onward: auto-submit window with 5-minute risk reminders

## Notes

- Main solved-check uses LeetCode GraphQL `recentAcSubmissionList`.
- Post auto-submit verification also checks non-AC submission activity.
- Auto-submit picks a problem from internal fallback URLs.
- Logs are written to `logs/`.
- Runtime reminder state is saved at `logs/runtimeState.json`.
