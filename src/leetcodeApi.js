const axios = require('axios');
const fs = require('fs');
const config = require('./config');
const { DEFAULT_USER_AGENT } = require('./constants');
const { log } = require('./logger');

const RECENT_SUBMISSIONS_QUERY = `
  query recentAcSubmissions($username: String!, $limit: Int!) {
    recentAcSubmissionList(username: $username, limit: $limit) {
      id
      title
      titleSlug
      timestamp
    }
  }
`;

const DAILY_CHALLENGE_QUERY = `
  query questionOfToday {
    activeDailyCodingChallengeQuestion {
      date
      userStatus
      link
      question {
        questionId
        questionFrontendId
        title
        titleSlug
        difficulty
      }
    }
  }
`;

const PLACEHOLDER_USERNAMES = new Set([
  'your_username',
  'your_leetcode_username',
  'username',
  '',
]);

/**
 * Resolves the LeetCode username from .env or runtime/session-meta.json.
 */
function resolveUsername() {
  const envUsername = config.leetcode.username?.trim();

  if (envUsername && !PLACEHOLDER_USERNAMES.has(envUsername.toLowerCase())) {
    return envUsername;
  }

  if (fs.existsSync(config.paths.sessionMeta)) {
    try {
      const meta = JSON.parse(fs.readFileSync(config.paths.sessionMeta, 'utf-8'));
      const metaUsername = meta.username?.trim();
      if (metaUsername && !PLACEHOLDER_USERNAMES.has(metaUsername.toLowerCase())) {
        return metaUsername;
      }
    } catch (error) {
      log(`[WARN] Could not read session metadata: ${error.message}`);
    }
  }

  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Posts a GraphQL query with retries for network errors, 429s, and 5xx responses.
 * GraphQL-level errors (bad username, schema issue) are not retried.
 */
async function postGraphql(query, variables, options = {}) {
  const { retries = 3, timeout = 12000 } = options;
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await axios.post(
        config.leetcode.graphqlUrl,
        { query, variables },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': DEFAULT_USER_AGENT,
            Referer: 'https://leetcode.com',
            Origin: 'https://leetcode.com',
          },
          timeout,
        }
      );

      if (Array.isArray(response.data?.errors) && response.data.errors.length > 0) {
        const message = response.data.errors
          .map((error) => error.message)
          .filter(Boolean)
          .join('; ');
        const error = new Error(message || 'LeetCode GraphQL error');
        error.nonRetryable = true;
        throw error;
      }

      return response.data?.data || null;
    } catch (error) {
      lastError = error;

      if (error.nonRetryable) break;

      const status = error.response?.status;
      const retryable = !status || status === 429 || status >= 500;
      if (!retryable) break;

      if (attempt < retries) {
        const waitMs = 1000 * attempt;
        log(`[WARN] LeetCode request failed (attempt ${attempt}/${retries}): ${error.message}. Retrying in ${waitMs}ms.`);
        await sleep(waitMs);
      }
    }
  }

  throw lastError || new Error('LeetCode request failed');
}

/**
 * Start of the current LeetCode streak day in epoch seconds.
 * LeetCode resets at 00:00 UTC (05:30 IST).
 */
function getStreakResetTimestamp(now = new Date()) {
  const resetUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
  );
  return Math.floor(resetUtc.getTime() / 1000);
}

async function getDailyCodingChallenge() {
  try {
    const data = await postGraphql(DAILY_CHALLENGE_QUERY, {}, { retries: 2, timeout: 10000 });
    const dcc = data?.activeDailyCodingChallengeQuestion;

    if (!dcc?.question) return null;

    return {
      date: dcc.date,
      userStatus: dcc.userStatus,
      link: `https://leetcode.com${dcc.link}`,
      title: dcc.question.title,
      slug: dcc.question.titleSlug,
      difficulty: dcc.question.difficulty,
      frontendId: dcc.question.questionFrontendId,
    };
  } catch (error) {
    log(`[WARN] Could not fetch today's challenge: ${error.message}`);
    return null;
  }
}

/**
 * Tri-state check for today's accepted submission:
 *   { status: 'SOLVED', submission }
 *   { status: 'UNSOLVED' }
 *   { status: 'ERROR', message }
 */
async function checkSubmissionsToday() {
  const username = resolveUsername();

  if (!username) {
    return {
      status: 'ERROR',
      message: 'LEETCODE_USERNAME is not configured.',
    };
  }

  try {
    const data = await postGraphql(RECENT_SUBMISSIONS_QUERY, { username, limit: 20 });
    const submissions = data?.recentAcSubmissionList;

    if (!Array.isArray(submissions)) {
      return {
        status: 'ERROR',
        username,
        message: 'LeetCode returned an unexpected response.',
      };
    }

    const resetTimestamp = getStreakResetTimestamp();
    const todaySubmission = submissions.find(
      (submission) => parseInt(submission.timestamp, 10) >= resetTimestamp
    );

    if (todaySubmission) {
      return {
        status: 'SOLVED',
        username,
        submission: {
          id: todaySubmission.id,
          title: todaySubmission.title,
          slug: todaySubmission.titleSlug,
          timestamp: parseInt(todaySubmission.timestamp, 10),
        },
      };
    }

    return { status: 'UNSOLVED', username };
  } catch (error) {
    return {
      status: 'ERROR',
      username,
      message: error.message,
    };
  }
}

module.exports = {
  resolveUsername,
  getStreakResetTimestamp,
  getDailyCodingChallenge,
  checkSubmissionsToday,
};
