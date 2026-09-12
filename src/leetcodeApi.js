const axios = require('axios');
const fs = require('fs');
const config = require('./config');
const { DEFAULT_USER_AGENT } = require('./sessionManager');

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

/**
 * Resolves the LeetCode username:
 * 1. Checks LEETCODE_USERNAME from .env
 * 2. Checks runtime/session-meta.json
 */
function resolveUsername() {
  const envUsername = config.leetcode.username?.trim();
  const placeholders = ['your_username', 'your_leetcode_username', 'username', ''];

  if (envUsername && !placeholders.includes(envUsername.toLowerCase())) {
    return envUsername;
  }

  if (fs.existsSync(config.paths.sessionMeta)) {
    try {
      const meta = JSON.parse(fs.readFileSync(config.paths.sessionMeta, 'utf-8'));
      if (meta.username && meta.username.trim() && !placeholders.includes(meta.username.trim().toLowerCase())) {
        return meta.username.trim();
      }
    } catch (e) {
      // Ignore
    }
  }

  return envUsername || null;
}

/**
 * Calculates start epoch timestamp (in seconds) of the current LeetCode streak cycle.
 * LeetCode resets daily at 00:00 UTC (05:30 IST).
 */
function getStreakResetTimestamp(now = new Date()) {
  const resetUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
  );
  return Math.floor(resetUtc.getTime() / 1000);
}

/**
 * Queries today's official LeetCode Daily Coding Challenge (DCC).
 */
async function getDailyCodingChallenge() {
  try {
    const response = await axios.post(
      config.leetcode.graphqlUrl,
      { query: DAILY_CHALLENGE_QUERY },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': DEFAULT_USER_AGENT,
          'Referer': 'https://leetcode.com',
          'Origin': 'https://leetcode.com',
        },
        timeout: 10000,
      }
    );

    const dcc = response.data?.data?.activeDailyCodingChallengeQuestion;
    if (!dcc) return null;

    return {
      date: dcc.date,
      userStatus: dcc.userStatus,
      link: `https://leetcode.com${dcc.link}`,
      title: dcc.question?.title,
      slug: dcc.question?.titleSlug,
      difficulty: dcc.question?.difficulty,
      frontendId: dcc.question?.questionFrontendId,
    };
  } catch (error) {
    console.warn('[WARN] Could not fetch Daily Coding Challenge:', error.message);
    return null;
  }
}

/**
 * Performs a robust tri-state check for today's LeetCode submissions:
 * Returns:
 *   { status: 'SOLVED', submission: { title, slug, timestamp } }
 *   { status: 'UNSOLVED' }
 *   { status: 'ERROR', message: string }
 */
async function checkSubmissionsToday() {
  const username = resolveUsername();

  if (!username) {
    console.warn('[WARN] No username found in .env or session-meta.json.');
    return {
      status: 'ERROR',
      message: 'No LeetCode username available. Please configure .env or run "npm run login".',
    };
  }

  try {
    const response = await axios.post(
      config.leetcode.graphqlUrl,
      {
        query: RECENT_SUBMISSIONS_QUERY,
        variables: {
          username,
          limit: 15,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': DEFAULT_USER_AGENT,
          'Referer': 'https://leetcode.com',
          'Origin': 'https://leetcode.com',
        },
        timeout: 12000,
      }
    );

    const submissions = response.data?.data?.recentAcSubmissionList;
    if (!submissions || !Array.isArray(submissions)) {
      return { status: 'UNSOLVED', username };
    }

    const resetTimestamp = getStreakResetTimestamp();

    // Check if any accepted submission has occurred since 00:00 UTC
    const todaySubmission = submissions.find(
      (sub) => parseInt(sub.timestamp, 10) >= resetTimestamp
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

    return {
      status: 'UNSOLVED',
      username,
    };
  } catch (error) {
    console.error('[ERROR] LeetCode GraphQL submission query failed:', error.message);
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
