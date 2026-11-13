const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// LeetCode resets the daily challenge at 00:00 UTC, which is 05:30 IST.
const LEETCODE_RESET_MINUTES_IST = 5 * 60 + 30;

module.exports = {
  DEFAULT_USER_AGENT,
  LEETCODE_RESET_MINUTES_IST,
};
