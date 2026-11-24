const axios = require('axios');
const config = require('./config');
const { DEFAULT_USER_AGENT } = require('./constants');
const { log } = require('./logger');

const RECENT_SUBMISSIONS_QUERY = `
  query recentSubmissions($username: String!, $limit: Int!) {
    recentSubmissionList(username: $username, limit: $limit) {
      id
      title
      titleSlug
      timestamp
      statusDisplay
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
        status
        topicTags {
          slug
        }
      }
    }
  }
`;

const SESSION_QUERY = `
  query session {
    userStatus {
      isSignedIn
      username
    }
  }
`;

const USER_STATS_QUERY = `
  query userStats($username: String!) {
    matchedUser(username: $username) {
      username
      profile {
        ranking
      }
      submitStatsGlobal {
        acSubmissionNum {
          difficulty
          count
        }
      }
      tagProblemCounts {
        advanced { tagName tagSlug problemsSolved }
        intermediate { tagName tagSlug problemsSolved }
        fundamental { tagName tagSlug problemsSolved }
      }
      userCalendar {
        streak
        totalActiveDays
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
 * Resolves the LeetCode username from the environment.
 */
function resolveUsername() {
  const username = config.leetcode.username?.trim();

  if (!username || PLACEHOLDER_USERNAMES.has(username.toLowerCase())) {
    return null;
  }

  return username;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Builds the Cookie header for authenticated requests. Session values are
 * secrets and must never be logged.
 */
function getAuthHeaders() {
  const session = config.leetcode.session?.trim();
  if (!session) return null;

  const csrfToken = config.leetcode.csrfToken?.trim();
  const cookie = [`LEETCODE_SESSION=${session}`];

  if (csrfToken) cookie.push(`csrftoken=${csrfToken}`);

  return {
    Cookie: cookie.join('; '),
    ...(csrfToken ? { 'x-csrftoken': csrfToken } : {}),
  };
}

/**
 * Posts a GraphQL query with retries for network errors, 429s, and 5xx responses.
 * GraphQL-level errors (bad username, schema issue) are not retried.
 *
 * Set `options.auth` for queries that depend on the signed-in user (status,
 * daily challenge status). Without a configured session those queries are
 * skipped by the caller rather than sent anonymously, because LeetCode returns
 * misleading defaults (every problem looks unsolved) for anonymous requests.
 */
async function postGraphql(query, variables, options = {}) {
  const { retries = 3, timeout = 12000, auth = false } = options;
  const authHeaders = auth ? getAuthHeaders() : null;

  if (auth && !authHeaders) {
    const error = new Error('LEETCODE_SESSION is not configured.');
    error.nonRetryable = true;
    throw error;
  }

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
            ...(authHeaders || {}),
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

function normalizeDailyChallenge(dcc) {
  if (!dcc?.question) return null;

  return {
    date: dcc.date,
    userStatus: dcc.userStatus,
    link: `https://leetcode.com${dcc.link}`,
    title: dcc.question.title,
    slug: dcc.question.titleSlug,
    difficulty: dcc.question.difficulty,
    frontendId: dcc.question.questionFrontendId,
    status: dcc.question.status || null,
    tags: (dcc.question.topicTags || []).map((tag) => tag.slug),
  };
}

async function fetchDailyChallenge(auth) {
  const data = await postGraphql(
    DAILY_CHALLENGE_QUERY,
    {},
    { retries: 2, timeout: 10000, auth }
  );

  return normalizeDailyChallenge(data?.activeDailyCodingChallengeQuestion);
}

async function getDailyCodingChallenge() {
  const useAuth = Boolean(config.leetcode.session);

  try {
    return await fetchDailyChallenge(useAuth);
  } catch (error) {
    // An expired session must not hide the challenge itself. Retry publicly:
    // the challenge is public, only its status needs the session.
    if (useAuth) {
      try {
        const fallback = await fetchDailyChallenge(false);
        log('[WARN] Daily challenge status unavailable; showing the challenge without status.');
        return fallback;
      } catch {
        // Fall through to the warning below.
      }
    }

    log(`[WARN] Could not fetch today's challenge: ${error.message}`);
    return null;
  }
}

/**
 * Returns the newest submission on or after the streak reset, or null.
 * LeetCode's streak is activity-based: any submission counts, including
 * Wrong Answer, TLE, MLE, and Runtime Error.
 */
function findTodaySubmission(submissions, resetTimestamp) {
  if (!Array.isArray(submissions)) return null;

  return (
    submissions.find((submission) => parseInt(submission.timestamp, 10) >= resetTimestamp) ||
    null
  );
}

function normalizeSubmission(submission) {
  const statusDisplay = submission.statusDisplay || 'Submitted';

  return {
    id: submission.id,
    title: submission.title,
    slug: submission.titleSlug,
    timestamp: parseInt(submission.timestamp, 10),
    statusDisplay,
    accepted: statusDisplay === 'Accepted',
  };
}

/**
 * Tri-state check for today's streak activity:
 *   { status: 'SAFE', submission }   - any submission today
 *   { status: 'PENDING' }            - no submission today
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
    const submissions = data?.recentSubmissionList;

    if (!Array.isArray(submissions)) {
      return {
        status: 'ERROR',
        username,
        message: 'LeetCode returned an unexpected response.',
      };
    }

    const todaySubmission = findTodaySubmission(submissions, getStreakResetTimestamp());

    if (todaySubmission) {
      return {
        status: 'SAFE',
        username,
        submission: normalizeSubmission(todaySubmission),
      };
    }

    return { status: 'PENDING', username };
  } catch (error) {
    return {
      status: 'ERROR',
      username,
      message: error.message,
    };
  }
}

/**
 * Normalizes the public profile payload used by the recommendation engine.
 */
function normalizeUserStats(matchedUser, username) {
  if (!matchedUser) return null;

  const solved = { All: 0, Easy: 0, Medium: 0, Hard: 0 };

  for (const row of matchedUser.submitStatsGlobal?.acSubmissionNum || []) {
    if (row?.difficulty in solved) {
      solved[row.difficulty] = Number(row.count) || 0;
    }
  }

  const tagSolved = {};
  for (const group of ['fundamental', 'intermediate', 'advanced']) {
    for (const tag of matchedUser.tagProblemCounts?.[group] || []) {
      if (!tag?.tagSlug) continue;
      tagSolved[tag.tagSlug] =
        (tagSolved[tag.tagSlug] || 0) + (Number(tag.problemsSolved) || 0);
    }
  }

  return {
    username: matchedUser.username || username,
    ranking: matchedUser.profile?.ranking ?? null,
    streak: Number(matchedUser.userCalendar?.streak) || 0,
    totalActiveDays: Number(matchedUser.userCalendar?.totalActiveDays) || 0,
    solved,
    tagSolved,
  };
}

async function getUserStats(username) {
  const data = await postGraphql(
    USER_STATS_QUERY,
    { username },
    { retries: 2, timeout: 12000 }
  );

  return normalizeUserStats(data?.matchedUser, username);
}

const TAG_SLUG_PATTERN = /^[a-z0-9-]+$/;
const PROBLEM_SLUG_PATTERN = /^[a-z0-9-]+$/;
const DETAILS_BATCH_SIZE = 20;

/**
 * Fetches the total number of problems tagged with each topic. One GraphQL
 * request with aliases keeps this cheap enough to run on every recommendation.
 */
async function getTopicTotals(tags) {
  const unique = [...new Set((tags || []).filter((tag) => TAG_SLUG_PATTERN.test(tag)))];
  if (unique.length === 0) return {};

  const aliases = unique.map(
    (tag, index) =>
      `t${index}: problemsetQuestionListV2(limit:1, skip:0, filters:{filterCombineType:ALL, topicFilter:{topicSlugs:["${tag}"]}}) { totalLength }`
  );

  const data = await postGraphql(`query { ${aliases.join(' ')} }`, {}, { retries: 2, timeout: 12000 });
  const totals = {};

  unique.forEach((tag, index) => {
    totals[tag] = Number(data?.[`t${index}`]?.totalLength) || 0;
  });

  return totals;
}

/**
 * Fetches the number of solved problems per topic for the signed-in user.
 * Unlike `tagProblemCounts`, this covers every topic, including heap, prefix
 * sum, and trie. Requires an authenticated session.
 */
async function getTopicSolvedCounts(tags) {
  const unique = [...new Set((tags || []).filter((tag) => TAG_SLUG_PATTERN.test(tag)))];
  const solved = {};
  const batchSize = 15;

  for (let start = 0; start < unique.length; start += batchSize) {
    const batch = unique.slice(start, start + batchSize);
    const aliases = batch.map(
      (tag, index) =>
        `t${index}: problemsetQuestionListV2(limit:1, skip:0, filters:{filterCombineType:ALL, topicFilter:{topicSlugs:["${tag}"]}, statusFilter:{questionStatuses:[SOLVED]}}) { totalLength }`
    );

    const data = await postGraphql(
      `query { ${aliases.join(' ')} }`,
      {},
      { retries: 2, timeout: 12000, auth: true }
    );

    batch.forEach((tag, index) => {
      solved[tag] = Number(data?.[`t${index}`]?.totalLength) || 0;
    });
  }

  return solved;
}

/**
 * Returns status and tags for a list of problem slugs. `status` is one of
 * 'ac' (solved), 'notac' (attempted, unsolved), or null (never attempted).
 * Requires an authenticated LeetCode session; an expired session makes every
 * status null, which the caller must treat as unverified.
 */
async function getQuestionDetails(slugs, { auth = true } = {}) {
  const unique = [...new Set((slugs || []).filter((slug) => PROBLEM_SLUG_PATTERN.test(slug)))];
  const details = {};

  for (let start = 0; start < unique.length; start += DETAILS_BATCH_SIZE) {
    const batch = unique.slice(start, start + DETAILS_BATCH_SIZE);
    const aliases = batch.map(
      (slug, index) =>
        `q${index}: question(titleSlug:"${slug}") { titleSlug status topicTags { slug } }`
    );

    const data = await postGraphql(
      `query { ${aliases.join(' ')} }`,
      {},
      { retries: 2, timeout: 12000, auth }
    );

    batch.forEach((slug, index) => {
      const node = data?.[`q${index}`];
      if (!node) return;
      details[slug] = {
        status: node.status || null,
        tags: (node.topicTags || []).map((tag) => tag.slug),
      };
    });
  }

  return details;
}

/**
 * Checks whether the configured session cookie is still valid and belongs to
 * the configured user.
 */
async function getSessionStatus() {
  if (!config.leetcode.session) {
    return { signedIn: false, configured: false, username: null };
  }

  try {
    const data = await postGraphql(
      SESSION_QUERY,
      {},
      { retries: 1, timeout: 8000, auth: true }
    );

    return {
      signedIn: Boolean(data?.userStatus?.isSignedIn),
      configured: true,
      username: data?.userStatus?.username || null,
    };
  } catch (error) {
    log(`[WARN] Could not verify the LeetCode session: ${error.message}`);
    return { signedIn: false, configured: true, username: null };
  }
}

/**
 * Recent submissions for the public profile. Used to detect same-day activity
 * and to prefer problems that continue the user's current track.
 */
async function getRecentSubmissions(username, limit = 20) {
  const data = await postGraphql(
    RECENT_SUBMISSIONS_QUERY,
    { username, limit },
    { retries: 2, timeout: 10000 }
  );

  return (data?.recentSubmissionList || []).map(normalizeSubmission);
}

module.exports = {
  resolveUsername,
  getStreakResetTimestamp,
  getDailyCodingChallenge,
  findTodaySubmission,
  normalizeSubmission,
  normalizeUserStats,
  checkSubmissionsToday,
  getUserStats,
  getTopicTotals,
  getTopicSolvedCounts,
  getQuestionDetails,
  getSessionStatus,
  getRecentSubmissions,
};
