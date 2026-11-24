const fs = require('fs');
const path = require('path');
const config = require('./config');
const { log } = require('./logger');

const STORE_VERSION = 1;
const MAX_HISTORY = 30;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function defaultStore() {
  return {
    version: STORE_VERSION,
    history: [],
    today: null,
  };
}

function normalizeStore(parsed) {
  const store = defaultStore();
  if (!parsed || typeof parsed !== 'object') return store;

  if (Array.isArray(parsed.history)) {
    store.history = parsed.history
      .filter((entry) => entry && typeof entry.slug === 'string' && typeof entry.date === 'string')
      .slice(0, MAX_HISTORY);
  }

  if (parsed.today && typeof parsed.today === 'object' && parsed.today.date && parsed.today.result) {
    store.today = parsed.today;
  }

  return store;
}

function loadStore() {
  const filePath = config.paths.runtimeRecommendation;

  if (!fs.existsSync(filePath)) return defaultStore();

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return defaultStore();
    return normalizeStore(JSON.parse(raw));
  } catch (error) {
    log(`[WARN] Could not read recommendation cache; starting fresh: ${error.message}`);
    return defaultStore();
  }
}

function saveStore(store) {
  const filePath = config.paths.runtimeRecommendation;
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.tmp`
  );

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    log(`[ERROR] Could not save the recommendation cache: ${error.message}`);
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // Cache cleanup must never break a guardian run.
    }
  }
}

/**
 * Returns today's cached recommendation when it matches the user and is still
 * fresh. The TTL keeps a solved recommendation from being repeated all day.
 */
function getCachedResult(store, { date, username, now = new Date() }) {
  const today = store?.today;
  if (!today || today.date !== date) return null;
  if (today.username && username && today.username !== username) return null;

  // If a session was added after an unverified run, recompute immediately
  // instead of serving the unverified result until the TTL expires.
  if (config.leetcode.session && today.result?.verified === false) return null;

  const generatedAt = new Date(today.result?.generatedAt || 0).getTime();
  if (!Number.isFinite(generatedAt) || now.getTime() - generatedAt > CACHE_TTL_MS) {
    return null;
  }

  return today.result;
}

/**
 * Stores today's result and appends the pick to the recommendation history so
 * the same problem is not recommended again inside the dedupe window.
 */
function rememberResult(store, { date, username, result, now = new Date() }) {
  const next = normalizeStore(store);
  next.today = { date, username: username || null, result };

  if (result?.recommendation?.slug) {
    next.history = [
      {
        slug: result.recommendation.slug,
        title: result.recommendation.title,
        date,
        recordedAt: now.toISOString(),
      },
      ...next.history.filter((entry) => entry.slug !== result.recommendation.slug),
    ].slice(0, MAX_HISTORY);
  }

  return next;
}

module.exports = {
  STORE_VERSION,
  MAX_HISTORY,
  CACHE_TTL_MS,
  defaultStore,
  normalizeStore,
  loadStore,
  saveStore,
  getCachedResult,
  rememberResult,
};
