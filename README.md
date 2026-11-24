# LeetCode Streak Guardian

Checks whether you have submitted anything on LeetCode every 10 minutes from morning to just before the streak reset, sends short Telegram reminders until you do, and recommends **one** next problem based on your solved-problem coverage. No auto-submit.

## How it works

```text
Cloudflare Worker cron (every 10 min, 9:30 AM - 5:20 AM IST)
  -> start the GitHub Actions workflow
  -> check today's submissions (any status counts)
  -> submitted? exit
  -> not yet? send the next reminder for the current time window
       morning/evening: today's challenge + one recommendation
```

GitHub's own `schedule` trigger is intentionally not used: it delays and drops
runs under load. The Cloudflare Worker in `scheduler/` is the only scheduler.

LeetCode resets the daily streak at **05:30 AM IST** (00:00 UTC). The bot stops reminding after that.

## What counts for the streak

LeetCode's daily streak is activity-based, not acceptance-based. A **Wrong Answer** keeps the streak alive just like an Accepted submission, and so do Time Limit Exceeded, Memory Limit Exceeded, and Runtime Error. The bot reads the recent submission list, so it stops reminding as soon as any submission is recorded for the day.

## Reminder schedule (IST)

| Time | Behaviour |
| --- | --- |
| 9:30 AM - 5:30 PM | Every 60 minutes; the morning reminder includes today's challenge |
| 5:30 PM - 6:00 PM | Quiet |
| 6:00 PM - 8:00 PM | One reminder, with today's daily challenge link |
| 8:00 PM - 10:00 PM | Every 30 minutes |
| 10:00 PM - 1:00 AM | Every 15 minutes |
| 1:00 AM - 5:30 AM | Every 10 minutes |
| 5:30 AM - 9:30 AM | Quiet |

A "streak safe" message is sent once if you submit after receiving a reminder.

## Message format

Messages are plain text and keep to the current status, time, reset countdown, the daily challenge, and at most one recommendation. Morning reminders start with a greeting, and reminders address you once as "sir". Examples:

```text
Good morning, sir,
📌 Today's LeetCode streak is pending
No submission today.
Time: 9:30 AM IST | Reset in 20h 00m
Challenge: Climbing Stairs II (Medium)
https://leetcode.com/problems/climbing-stairs-ii/
🎯 Next: Reorganize String (Medium)
https://leetcode.com/problems/reorganize-string/
```

```text
📌 Today's LeetCode streak is pending
No submission today, sir.
Time: 6:15 PM IST | Reset: 5:30 AM IST (in 11h 15m)
Challenge: Climbing Stairs II (Medium)
https://leetcode.com/problems/climbing-stairs-ii/
🎯 Next: Reorganize String (Medium)
https://leetcode.com/problems/reorganize-string/
```

```text
✅ LeetCode streak safe
Submitted: Climbing Stairs II (Wrong Answer)
Date: 2026-11-14
Streak secured, sir.
```

## Recommendations

The morning and evening reminders include one recommended problem. The engine
scores a curated pool in `src/problemCatalog.js` against your profile:

- **Topic coverage** — solved / total for each tagged topic. Core topics
  (graph, DP, heap, sliding window) weigh more than narrow tags like design.
- **Difficulty fit** — Medium is the target; Easy is a small step down and Hard
  is only chosen when the topic gap is large.
- **Status** — solved problems are always excluded. Attempted-but-unsolved
  problems are labelled as a retry and preferred slightly less than new ones.
- **Momentum** — problems that share tags with your last few accepted
  submissions get a small boost, so the next step continues your current track.
- **Daily challenge** — today's challenge is added as a candidate. It gets a
  bonus only when the session confirms it is unsolved.
- **Variety** — a problem recommended in the last 10 days is skipped.

The result is cached in `runtime/recommendation.json` for six hours, so the
morning and evening messages agree and the bot does not hammer LeetCode.

### Run it directly

```bash
npm run recommend
npm run recommend -- --json      # raw result
npm run recommend -- --refresh   # ignore today's cache
npm run recommend -- --dry-run   # do not write the cache
```

### Verified status (optional but recommended)

Without a session, the engine can still read your public solved counts and
recent submissions, but it cannot prove which problems you already solved. It
then uses a bundled solved-count snapshot and marks the result **unverified**.

To verify status, copy two values from a signed-in `leetcode.com` browser
session into `.env` (or GitHub Actions secrets):

1. Open DevTools → **Application** → **Cookies** → `https://leetcode.com`.
2. Copy `LEETCODE_SESSION` and `csrftoken`.
3. Set them as `LEETCODE_SESSION` and `LEETCODE_CSRFTOKEN`.

The session grants access to your LeetCode account. Treat it like a password,
set an expiry reminder, and rotate it when it expires (roughly every two weeks).
Recommendations fall back to unverified mode automatically when it expires.

### How the score is computed

```text
score = 0.9 * topic_need * topic_importance
      + 0.25 * secondary_topic_need
      + difficulty_fit
      + status_bonus
      + momentum_bonus
      + daily_bonus
      - repeat_penalty
```

`topic_need` is `1 - solved/total`. The highest score wins; ties fall back to
the catalog's curated priority. The engine is deterministic, so the same
profile and day always produce the same recommendation.

## Setup

### 1. Install

```bash
npm ci --omit=dev
```

The reminder bot only needs `axios`, `dotenv`, and `node-cron`.

### 2. Local environment

Copy `.env.example` to `.env` and set:

```env
LEETCODE_USERNAME=your_leetcode_username
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id
LEETCODE_SESSION=optional_for_verified_recommendations
LEETCODE_CSRFTOKEN=optional_for_verified_recommendations
```

### 3. GitHub Actions secrets

In the repository, go to **Settings -> Secrets and variables -> Actions** and add:

- `LEETCODE_USERNAME` (repository variable or secret)
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `LEETCODE_SESSION` (optional, for verified recommendations)
- `LEETCODE_CSRFTOKEN` (optional, for verified recommendations)

Without the session secrets the bot still works; recommendations are marked
unverified and use a bundled topic snapshot.

### 4. Run

```bash
npm start      # local scheduler, every 10 minutes
npm run once   # one cycle only
npm test       # test suite
```

## Scheduler setup (Cloudflare Workers)

The scheduler is a tiny Worker with one Cron Trigger. Every 10 minutes it sends
`POST /repos/{owner}/{repo}/actions/workflows/guardian.yml/dispatches`, which
starts the workflow. It needs no database and uses about 144 invocations per
day out of the free tier's 100,000.

### 1. Create the GitHub token

1. GitHub -> **Settings -> Developer settings -> Personal access tokens ->
   Fine-grained tokens -> Generate new token**.
2. **Repository access:** Only select repositories -> `leetcode-streak-guardian`.
3. **Repository permissions -> Actions:** Read and write. Leave everything else
   at "No access".
4. Set an expiry (one year is the maximum) and copy the token.

The token can only start workflows; it cannot read your code or secrets. When
it expires, run `npx wrangler secret put GITHUB_TOKEN` again with a new one.

### 2. Log in and deploy

```bash
cd scheduler
npm install
npx wrangler login
```

`wrangler login` opens a browser tab. Sign in to Cloudflare (the free plan is
enough) and approve the request. If the browser cannot be opened, create an API
token from **My Profile -> API Tokens -> Create Token -> Edit Cloudflare
Workers**, then prefix the deploy commands with `CLOUDFLARE_API_TOKEN=<token>`.

Then deploy and store the GitHub token as an encrypted Worker secret:

```bash
npx wrangler deploy
npx wrangler secret put GITHUB_TOKEN
```

Paste the fine-grained token when prompted. The secret is never written to disk.

> Run `wrangler deploy` before `secret put` so the Worker exists. A cron tick
> between the two commands logs a "missing GITHUB_TOKEN" error and does nothing
> else.

### 3. Verify

```bash
npx wrangler tail
```

Wait for the next 10-minute tick. A successful line looks like:

```text
Dispatched aryankinha/leetcode-streak-guardian guardian.yml@main (cron "*/10 4-23 * * *", ...)
```

The repository **Actions** tab should show a matching `workflow_dispatch` run.
Opening the Worker's `workers.dev` URL returns a small JSON health response and
starts nothing.

To test the full path immediately, run the workflow manually. This is the same
request the Worker makes:

```bash
gh workflow run guardian.yml -f test_alert=true
```

### 4. Change the schedule or repository

Edit `scheduler/wrangler.jsonc`:

- `triggers.crons` is in UTC. `*/10 4-23 * * *` is 9:30 AM to 5:20 AM IST.
- `vars.GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_WORKFLOW`, and `GITHUB_REF` point
  at this repository.

Run `npx wrangler deploy` again afterwards. Cron changes can take up to 15
minutes to propagate.

### Local testing (optional)

```bash
cd scheduler
npm test                 # unit tests, no network
npm run check            # validate the bundle without deploying
npx wrangler dev --test-scheduled
```

With the dev server running:

```bash
curl "http://localhost:8787/__scheduled?cron=*/10+4-23+*+*+*"
```

This calls the real GitHub API, so it needs `GITHUB_TOKEN` in
`scheduler/.dev.vars` and starts a real workflow run.

To stop the scheduler, run `npx wrangler delete` inside `scheduler/`.

## GitHub Actions

The workflow is **dispatch-only** (`workflow_dispatch`). The Cloudflare Worker
starts it every 10 minutes from 04:00 to 23:50 UTC (**9:30 AM to 5:20 AM IST**),
matching the reminder window.

This avoids two GitHub behaviours: scheduled runs are delayed or dropped under
load, and scheduled workflows in public repositories are disabled after 60 days
without repository activity. A dispatch-only workflow is not affected by the
60-day rule.

You can trigger a run, or a test message, manually at any time:

```bash
gh workflow run guardian.yml
gh workflow run guardian.yml -f test_alert=true
```

## State

Two files live in `runtime/` and are restored between GitHub Actions runs with
the Actions cache:

- `state.json` — reminder timestamps for the current streak day.
- `recommendation.json` — today's cached recommendation plus the last 30 picks,
  used to avoid repeats.

Neither file contains credentials. The LeetCode session is read from the
environment and is never written to disk or cached.

## Project structure

```text
src/
  index.js                 local cron entry point
  runOnce.js               GitHub Actions / one-shot entry point
  guardian.js              check submissions + decide whether to notify
  reminderEngine.js        IST windows, state, message text
  leetcodeApi.js           LeetCode GraphQL client (public + optional session)
  recommender.js           topic scoring and the single next recommendation
  problemCatalog.js        curated, non-premium recommendation pool
  recommendationStore.js   cache and repeat-avoidance history
  recommendationService.js daily cache wrapper
  recommend.js             `npm run recommend` CLI
  telegramNotifier.js
  constants.js
  config.js
  logger.js
test/
  guardian.test.js         reminders, windows, API helpers
  recommender.test.js      scoring, dedupe, daily integration, cache
scheduler/
  wrangler.jsonc           Cloudflare cron trigger + repository vars
  src/index.js             dispatches the GitHub Actions workflow
  test/index.test.js
```
