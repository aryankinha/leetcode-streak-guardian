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

async function fetchRecentSubmissions(username) {
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

  const data = await executeGraphql(query, { username }, 3);
  return data.recentSubmissionList || [];
}

function isSubmissionAfterReset(submission, resetEpoch) {
  return Number(submission?.timestamp) >= resetEpoch;
}

function getLatestSubmittedProblemSlug(submissions) {
  const latestWithSlug = [...submissions]
    .filter((submission) => typeof submission?.titleSlug === "string" && submission.titleSlug.trim())
    .sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0))[0];
  return latestWithSlug ? latestWithSlug.titleSlug.trim() : "two-sum";
}

async function hasSubmittedToday(username) {
  if (!username) {
    throw new Error("LEETCODE_USERNAME is required");
  }

  const submissions = await fetchRecentSubmissions(username);
  const resetEpoch = getTodayResetEpochSeconds();
  const submitted = submissions.some((submission) => isSubmissionAfterReset(submission, resetEpoch));

  return {
    submitted,
    resetEpoch,
    submissions,
    dayKey: getCurrentLeetCodeDayKey()
  };
}

module.exports = {
  hasSubmittedToday,
  fetchRecentSubmissions,
  getLatestSubmittedProblemSlug,
  getTodayResetEpochSeconds,
  getCurrentLeetCodeDayKey
};
