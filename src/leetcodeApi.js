const axios = require("axios");
const { config, log } = require("./config");

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function toIst(date = new Date()) {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

function getCurrentLeetCodeDayKey(now = new Date()) {
  const istNow = toIst(now);
  let dayAnchor = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate());
  const minuteOfDay = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();

  if (minuteOfDay < 5 * 60 + 30) {
    dayAnchor -= ONE_DAY_MS;
  }

  const anchor = new Date(dayAnchor);
  const year = anchor.getUTCFullYear();
  const month = String(anchor.getUTCMonth() + 1).padStart(2, "0");
  const day = String(anchor.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTodayResetEpochSeconds(now = new Date()) {
  const istNow = toIst(now);
  const y = istNow.getUTCFullYear();
  const m = istNow.getUTCMonth();
  const d = istNow.getUTCDate();

  let resetIstEpochMs = Date.UTC(y, m, d, 5, 30, 0);
  if (istNow.getUTCHours() * 60 + istNow.getUTCMinutes() < 5 * 60 + 30) {
    resetIstEpochMs -= ONE_DAY_MS;
  }

  return Math.floor((resetIstEpochMs - IST_OFFSET_MS) / 1000);
}

async function executeGraphql(query, variables, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await axios.post(
        config.leetcode.graphqlUrl,
        { query, variables },
        {
          timeout: 15000,
          headers: {
            "Content-Type": "application/json",
            Referer: "https://leetcode.com/"
          }
        }
      );

      if (response.data?.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(response.data.errors)}`);
      }

      return response.data?.data || {};
    } catch (error) {
      log("ERROR", `GraphQL request failed (attempt ${attempt}/${retries})`, {
        error: error.message,
        username: variables?.username || "unknown"
      });
      if (attempt === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }

  return {};
}

async function fetchRecentAcceptedSubmissions(username) {
  const query = `
    query recentAcSubmissions($username: String!) {
      recentAcSubmissionList(username: $username) {
        id
        title
        titleSlug
        timestamp
      }
    }
  `;

  const data = await executeGraphql(query, { username }, 3);
  return data.recentAcSubmissionList || [];
}

async function fetchRecentSubmissionsAnyStatus(username) {
  const query = `
    query recentSubmissions($username: String!) {
      recentSubmissionList(username: $username) {
        title
        titleSlug
        timestamp
        statusDisplay
      }
    }
  `;

  try {
    const data = await executeGraphql(query, { username }, 2);
    return data.recentSubmissionList || [];
  } catch (error) {
    log("WARN", "Unable to fetch non-AC submission list", { error: error.message });
    return [];
  }
}

function isSubmissionAfterReset(submission, resetEpoch) {
  return Number(submission?.timestamp) >= resetEpoch;
}

async function hasSolvedToday(username) {
  if (!username) {
    throw new Error("LEETCODE_USERNAME is required");
  }

  const submissions = await fetchRecentAcceptedSubmissions(username);
  const resetEpoch = getTodayResetEpochSeconds();
  const actualSolved = submissions.some((s) => isSubmissionAfterReset(s, resetEpoch));

  if (process.env.FORCE_LOGIN_TEST === "true") {
    log("DEBUG", "FORCE_LOGIN_TEST enabled: bypassing solvedToday check");
  }

  const solved = process.env.FORCE_LOGIN_TEST === "true" ? false : actualSolved;

  return {
    solved,
    resetEpoch,
    submissions,
    dayKey: getCurrentLeetCodeDayKey()
  };
}

async function hasSubmittedTodayAnyStatus(username) {
  if (!username) {
    throw new Error("LEETCODE_USERNAME is required");
  }

  const submissions = await fetchRecentSubmissionsAnyStatus(username);
  const resetEpoch = getTodayResetEpochSeconds();
  const submitted = submissions.some((s) => isSubmissionAfterReset(s, resetEpoch));

  return {
    submitted,
    resetEpoch,
    submissions,
    dayKey: getCurrentLeetCodeDayKey()
  };
}

module.exports = {
  hasSolvedToday,
  hasSubmittedTodayAnyStatus,
  fetchRecentAcceptedSubmissions,
  getTodayResetEpochSeconds,
  getCurrentLeetCodeDayKey
};
