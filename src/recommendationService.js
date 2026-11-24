const { recommend } = require('./recommender');
const { resolveUsername } = require('./leetcodeApi');
const {
  loadStore,
  saveStore,
  getCachedResult,
  rememberResult,
} = require('./recommendationStore');

/**
 * Returns one recommendation for the current UTC day, reusing the cached result
 * for up to six hours so the morning and evening reminders agree and a run does
 * not hit LeetCode repeatedly.
 */
async function getDailyRecommendation({
  username = resolveUsername(),
  now = new Date(),
  force = false,
  persist = true,
  ...deps
} = {}) {
  if (!username) {
    throw new Error('LEETCODE_USERNAME is not configured.');
  }

  const date = now.toISOString().slice(0, 10);
  const store = loadStore();

  if (!force) {
    const cached = getCachedResult(store, { date, username, now });
    if (cached) return cached;
  }

  const result = await recommend({
    username,
    now,
    history: store.history,
    ...deps,
  });

  if (persist) {
    saveStore(rememberResult(store, { date, username, result, now }));
  }

  return result;
}

module.exports = { getDailyRecommendation };
