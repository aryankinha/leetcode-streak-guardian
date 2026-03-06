# leetcode-streak-guardian

Node.js + Playwright service that protects a LeetCode streak using reminder escalation and emergency auto-submit.

## Setup

```bash
cd leetcode-streak-guardian
npm install
cp .env.example .env
# Fill .env values
```

## Runtime Session

- Session storage path: `runtime/session.json`
- The session file is generated automatically at runtime.
- `runtime/` is gitignored and must never be committed.

## Run locally

```bash
npm run install:browsers
npm start
```

By default, it runs one guardian cycle and exits (`USE_INTERNAL_CRON=false`).

To run as a daemon with internal schedule:

```env
USE_INTERNAL_CRON=true
CHECK_INTERVAL=10
```

## Render Cron Job

- Build command:

```bash
npm install && npx playwright install chromium
```

- Start command:

```bash
node src/index.js
```

- Cron schedule:

```cron
*/10 * * * *
```

## Notes

- Main solved-check uses LeetCode GraphQL `recentAcSubmissionList`.
- Post auto-submit verification also checks non-AC submission activity.
- Auto-submit picks a problem from internal fallback URLs (no problem URL env var required).
- In Render single-run mode with `CHECK_INTERVAL=10`, the service adds one 5-minute follow-up cycle during high-urgency stages (1 AM-5:30 AM IST).
- Logs are written to `logs/`.
- Runtime reminder state is saved at `logs/runtimeState.json`.
