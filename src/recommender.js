const { PROBLEM_CATALOG } = require('./problemCatalog');
const {
  resolveUsername,
  getUserStats,
  getTopicTotals,
  getTopicSolvedCounts,
  getQuestionDetails,
  getSessionStatus,
  getRecentSubmissions,
  getDailyCodingChallenge,
} = require('./leetcodeApi');

/**
 * Topic weights. Core algorithm topics count fully; narrow or low-signal tags
 * (design, simulation) count less so the engine does not chase a rare tag just
 * because its percentage is low.
 */
const TAG_IMPORTANCE = {
  'array': 0.85,
  'string': 0.85,
  'hash-table': 0.85,
  'math': 0.8,
  'sorting': 0.75,
  'dynamic-programming': 1.0,
  'greedy': 0.95,
  'binary-search': 0.85,
  'depth-first-search': 0.85,
  'breadth-first-search': 0.85,
  'tree': 0.8,
  'binary-tree': 0.8,
  'matrix': 0.9,
  'two-pointers': 0.8,
  'bit-manipulation': 0.75,
  'stack': 0.8,
  'graph': 1.0,
  'design': 0.6,
  'linked-list': 0.75,
  'heap-priority-queue': 1.0,
  'simulation': 0.5,
  'sliding-window': 1.0,
  'backtracking': 0.85,
  'union-find': 0.9,
  'trie': 0.7,
  'recursion': 0.7,
  'divide-and-conquer': 0.75,
  'memoization': 0.9,
  'queue': 0.7,
  'counting': 0.7,
  'merge-sort': 0.5,
  'monotonic-stack': 0.8,
  'segment-tree': 0.4,
  'binary-indexed-tree': 0.4,
  'topological-sort': 0.9,
  'shortest-path': 0.95,
  'prefix-sum': 0.85,
};

const TAG_LABELS = {
  'array': 'Array',
  'string': 'String',
  'hash-table': 'Hash table',
  'math': 'Math',
  'sorting': 'Sorting',
  'dynamic-programming': 'Dynamic programming',
  'greedy': 'Greedy',
  'binary-search': 'Binary search',
  'depth-first-search': 'Depth-first search',
  'breadth-first-search': 'Breadth-first search',
  'tree': 'Tree',
  'binary-tree': 'Binary tree',
  'matrix': 'Matrix',
  'two-pointers': 'Two pointers',
  'bit-manipulation': 'Bit manipulation',
  'stack': 'Stack',
  'graph': 'Graph',
  'design': 'Design',
  'linked-list': 'Linked list',
  'heap-priority-queue': 'Heap / priority queue',
  'simulation': 'Simulation',
  'sliding-window': 'Sliding window',
  'backtracking': 'Backtracking',
  'union-find': 'Union-Find',
  'trie': 'Trie',
  'recursion': 'Recursion',
  'divide-and-conquer': 'Divide and conquer',
  'memoization': 'Memoization',
  'queue': 'Queue',
  'counting': 'Counting',
  'merge-sort': 'Merge sort',
  'monotonic-stack': 'Monotonic stack',
  'segment-tree': 'Segment tree',
  'binary-indexed-tree': 'Binary indexed tree',
  'topological-sort': 'Topological sort',
  'shortest-path': 'Shortest path',
  'prefix-sum': 'Prefix sum',
};

const DIFFICULTY_FIT = {
  Easy: 0.05,
  Medium: 0.25,
  Hard: -0.1,
};

// Used only if the topic-total request fails. Snapshot: 2026-11-24.
const FALLBACK_TOPIC_TOTALS = {
  'array': 2280,
  'string': 900,
  'hash-table': 846,
  'math': 712,
  'dynamic-programming': 687,
  'sorting': 542,
  'greedy': 486,
  'binary-search': 356,
  'depth-first-search': 351,
  'breadth-first-search': 260,
  'tree': 272,
  'binary-tree': 181,
  'matrix': 285,
  'two-pointers': 264,
  'bit-manipulation': 298,
  'stack': 183,
  'graph': 190,
  'design': 134,
  'linked-list': 82,
  'heap-priority-queue': 223,
  'simulation': 218,
  'sliding-window': 176,
  'backtracking': 114,
  'union-find': 98,
  'trie': 61,
  'recursion': 51,
  'divide-and-conquer': 72,
  'memoization': 44,
  'queue': 58,
  'counting': 217,
  'merge-sort': 18,
  'monotonic-stack': 76,
  'segment-tree': 88,
  'binary-indexed-tree': 55,
  'topological-sort': 40,
  'shortest-path': 43,
  'prefix-sum': 277,
};

const DEDUPE_WINDOW_DAYS = 10;
const HISTORY_FOR_MOMENTUM = 5;

// Solved-per-tag fallback. LeetCode's public tagProblemCounts endpoint only
// exposes a curated subset of tags, so unverified runs use this snapshot for
// the remaining ones. Verified runs replace it with live per-tag counts.
// Snapshot: 2026-11-24.
const FALLBACK_TAG_SOLVED = {
  'array': 285,
  'string': 109,
  'hash-table': 87,
  'math': 96,
  'dynamic-programming': 61,
  'sorting': 66,
  'greedy': 28,
  'binary-search': 37,
  'depth-first-search': 83,
  'breadth-first-search': 61,
  'tree': 86,
  'binary-tree': 81,
  'matrix': 47,
  'two-pointers': 57,
  'bit-manipulation': 35,
  'stack': 37,
  'graph': 20,
  'design': 2,
  'linked-list': 36,
  'heap-priority-queue': 15,
  'simulation': 39,
  'sliding-window': 17,
  'backtracking': 33,
  'union-find': 8,
  'trie': 2,
  'recursion': 15,
  'divide-and-conquer': 16,
  'memoization': 5,
  'queue': 5,
  'counting': 22,
  'merge-sort': 2,
  'monotonic-stack': 13,
  'segment-tree': 2,
  'binary-indexed-tree': 2,
  'topological-sort': 6,
  'shortest-path': 2,
  'prefix-sum': 26,
};

function topicLabel(tag) {
  return TAG_LABELS[tag] || tag;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Builds solved/total/coverage/need entries for every topic that has both a
 * known solved count and a known total. Unknown tags are skipped rather than
 * treated as zero, because a missing tag in the API means "no data", not "no
 * problems solved".
 */
function buildTopicNeeds(tagSolved = {}, topicTotals = {}) {
  const needs = {};

  for (const [tag, total] of Object.entries(topicTotals)) {
    if (!(tag in tagSolved)) continue;

    const solved = Number(tagSolved[tag]) || 0;
    const safeTotal = Number(total) || 0;
    const coverage = safeTotal > 0 ? Math.min(solved / safeTotal, 1) : 0;

    needs[tag] = {
      tag,
      solved,
      total: safeTotal,
      coverage,
      need: 1 - coverage,
    };
  }

  return needs;
}

function catalogTags(catalog = PROBLEM_CATALOG) {
  return [...new Set(catalog.flatMap((problem) => problem.tags))];
}

function parseDate(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(fromDate, toDate) {
  const from = parseDate(fromDate);
  if (!from) return Infinity;
  return Math.abs(toDate.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
}

function wasRecommendedRecently(history, slug, now, windowDays = DEDUPE_WINDOW_DAYS) {
  if (!Array.isArray(history)) return false;

  const today = now.toISOString().slice(0, 10);

  return history.some(
    (entry) =>
      entry?.slug === slug &&
      entry.date !== today &&
      daysBetween(entry.date, now) <= windowDays
  );
}

/**
 * Creates the candidate list: the curated catalog plus today's challenge when
 * it is not already in the catalog.
 */
function buildCandidates({ catalog, daily, details, verified }) {
  const candidates = catalog.map((problem) => {
    const detail = details[problem.slug] || null;
    const rawStatus = detail?.status || null;
    const status = rawStatus === 'notac' ? 'retry' : 'new';

    return {
      ...problem,
      status,
      isDaily: Boolean(daily && daily.slug === problem.slug),
      tags: detail?.tags?.length ? detail.tags : problem.tags,
    };
  });

  if (daily && !catalog.some((problem) => problem.slug === daily.slug)) {
    const knownTags = daily.tags || [];
    const primaryTag =
      knownTags.find((tag) => FALLBACK_TOPIC_TOTALS[tag]) || knownTags[0] || 'array';

    candidates.push({
      slug: daily.slug,
      frontendId: daily.frontendId,
      title: daily.title,
      difficulty: daily.difficulty,
      primaryTag,
      tags: knownTags,
      concept: "Today's challenge",
      why: 'The daily challenge is unread material and counts toward the streak.',
      priority: 999,
      status: daily.status === 'notac' ? 'retry' : 'new',
      isDaily: true,
      fromCatalog: false,
    });
  }

  return candidates.filter((candidate) => {
    const detail = details[candidate.slug];
    if (verified && detail?.status === 'ac') return false;
    if (verified && !detail) return false;
    return true;
  });
}

function scoreCandidate(candidate, context) {
  const { topicNeeds, recentTags, daily, now, history, verified } = context;
  const primary = topicNeeds[candidate.primaryTag] || {
    tag: candidate.primaryTag,
    solved: 0,
    total: 0,
    coverage: 0.5,
    need: 0.5,
  };
  const importance = TAG_IMPORTANCE[candidate.primaryTag] ?? 0.7;

  const secondaryNeeds = candidate.tags
    .filter((tag) => tag !== candidate.primaryTag && topicNeeds[tag])
    .map((tag) => topicNeeds[tag].need);

  const overlap = candidate.tags.filter((tag) => recentTags.has(tag));
  const isDaily = Boolean(daily && candidate.slug === daily.slug);
  const dailyUnsolved = isDaily && verified && daily.status !== 'ac';
  const repeat = wasRecommendedRecently(history, candidate.slug, now);

  const score =
    0.9 * primary.need * importance +
    0.25 * average(secondaryNeeds) +
    (DIFFICULTY_FIT[candidate.difficulty] ?? 0) +
    (candidate.status === 'retry' ? 0.05 : 0.15) +
    (overlap.length > 0 ? 0.1 : 0) +
    (dailyUnsolved ? 0.2 : 0) -
    (repeat ? 1.5 : 0);

  return { score, primary, overlap, isDaily, dailyUnsolved, repeat };
}

function buildReason(candidate, scored) {
  const { primary, overlap, isDaily } = scored;
  const label = topicLabel(candidate.primaryTag);
  const coverage = Math.round(primary.coverage * 100);
  const parts = [];

  if (candidate.status === 'retry') {
    parts.push(
      `You attempted this before; ${label.toLowerCase()} is at ${primary.solved}/${primary.total} (${coverage}%).`
    );
  } else if (isDaily) {
    parts.push(
      `Today's challenge targets ${label.toLowerCase()}, one of your weakest topics (${coverage}%).`
    );
  } else {
    parts.push(
      `${label} is at ${primary.solved}/${primary.total} (${coverage}% coverage), and this teaches ${candidate.concept.toLowerCase()}.`
    );
  }

  if (overlap.length > 0) {
    const labels = [...new Set(overlap.map(topicLabel))];
    parts.push(`It also continues your recent ${labels.join(' / ')} work.`);
  }

  return parts.join(' ');
}

function pickRecommendation(candidates, context) {
  let best = null;

  for (const candidate of candidates) {
    const scored = scoreCandidate(candidate, context);
    const entry = { candidate, scored };

    if (!best) {
      best = entry;
      continue;
    }

    if (scored.score > best.scored.score + 0.0001) {
      best = entry;
      continue;
    }

    if (Math.abs(scored.score - best.scored.score) <= 0.0001) {
      const priorityA = candidate.priority ?? 500;
      const priorityB = best.candidate.priority ?? 500;
      if (priorityA < priorityB) best = entry;
    }
  }

  return best;
}

function buildCoverageSummary(topicNeeds, limit = 8) {
  return Object.values(topicNeeds)
    .filter((item) => item.total >= 50)
    .sort((a, b) => a.coverage - b.coverage)
    .slice(0, limit)
    .map((item) => ({
      tag: item.tag,
      label: topicLabel(item.tag),
      solved: item.solved,
      total: item.total,
      coveragePct: Math.round(item.coverage * 100),
    }));
}

/**
 * Main entry point. Pure-ish: all network access goes through injected
 * functions, which keeps scoring testable without mocking axios.
 */
async function recommend({
  username = resolveUsername(),
  now = new Date(),
  history = [],
  catalog = PROBLEM_CATALOG,
  fetchStats = getUserStats,
  fetchTopicTotals = getTopicTotals,
  fetchTopicSolved = getTopicSolvedCounts,
  fetchDetails = getQuestionDetails,
  fetchSession = getSessionStatus,
  fetchRecent = getRecentSubmissions,
  fetchDaily = getDailyCodingChallenge,
} = {}) {
  if (!username) {
    throw new Error('LEETCODE_USERNAME is not configured.');
  }

  const limitations = [];
  const [stats, daily, recent, session] = await Promise.all([
    fetchStats(username),
    fetchDaily().catch(() => null),
    fetchRecent(username, 20).catch(() => []),
    fetchSession().catch(() => ({ signedIn: false, configured: false, username: null })),
  ]);

  if (!stats) {
    throw new Error(`Could not load the LeetCode profile for ${username}.`);
  }

  let verified = Boolean(session?.signedIn) && session.username === username;

  if (session?.signedIn && session.username && session.username !== username) {
    limitations.push(
      `The configured LeetCode session belongs to ${session.username}, not ${username}; status checks were skipped.`
    );
  } else if (!session?.signedIn) {
    limitations.push(
      session?.configured
        ? 'The LeetCode session is expired or invalid; problem status could not be verified.'
        : 'LEETCODE_SESSION is not configured; problem status could not be verified.'
    );
  }

  const tags = catalogTags(catalog);
  let tagSolved = { ...FALLBACK_TAG_SOLVED, ...(stats.tagSolved || {}) };

  if (verified) {
    try {
      const liveSolved = await fetchTopicSolved(tags);
      tagSolved = { ...tagSolved, ...liveSolved };
    } catch (error) {
      limitations.push(
        'Live per-topic solved counts could not be loaded; using the bundled snapshot.'
      );
    }
  } else {
    limitations.push(
      'Per-topic solved counts use a bundled snapshot; configure LEETCODE_SESSION for live coverage.'
    );
  }

  const detailSlugs = [
    ...catalog.map((problem) => problem.slug),
    ...recent.filter((submission) => submission.accepted).slice(0, 8).map((submission) => submission.slug),
    daily?.slug,
  ].filter(Boolean);

  let details = {};
  try {
    details = await fetchDetails(detailSlugs, { auth: verified });
  } catch (error) {
    verified = false;
    limitations.push(`Problem status lookup failed: ${error.message}`);
  }

  let totals = {};

  try {
    totals = await fetchTopicTotals(tags);
  } catch (error) {
    totals = FALLBACK_TOPIC_TOTALS;
    limitations.push(`Topic totals could not be refreshed; using the bundled snapshot.`);
  }

  const topicNeeds = buildTopicNeeds(tagSolved, totals);

  const recentAccepted = recent.filter((submission) => submission.accepted);
  const recentTags = new Set(
    recentAccepted
      .slice(0, HISTORY_FOR_MOMENTUM)
      .flatMap((submission) => details[submission.slug]?.tags || [])
  );
  const recentSolvedSlugs = new Set(recentAccepted.map((submission) => submission.slug));

  const candidates = buildCandidates({ catalog, daily, details, verified }).filter(
    (candidate) =>
      !(verified && details[candidate.slug]?.status === 'ac') &&
      !(!verified && recentSolvedSlugs.has(candidate.slug))
  );

  const context = {
    topicNeeds,
    recentTags,
    daily,
    now,
    history,
    verified,
  };

  const best = pickRecommendation(candidates, context);

  let recommendation = null;
  if (best) {
    const { candidate, scored } = best;
    const url = `https://leetcode.com/problems/${candidate.slug}/`;

    recommendation = {
      slug: candidate.slug,
      frontendId: candidate.frontendId,
      title: candidate.title,
      difficulty: candidate.difficulty,
      url,
      tags: candidate.tags,
      primaryTag: candidate.primaryTag,
      primaryTagLabel: topicLabel(candidate.primaryTag),
      concept: candidate.concept,
      why: candidate.why,
      status: candidate.status,
      score: Math.round(scored.score * 1000) / 1000,
      isDaily: scored.isDaily,
      reason: buildReason(candidate, scored),
    };
  } else {
    limitations.push('Every problem in the current catalog is solved or was recommended recently.');
  }

  return {
    username,
    generatedAt: now.toISOString(),
    verified,
    session: {
      configured: Boolean(session?.configured),
      signedIn: Boolean(session?.signedIn),
    },
    profile: {
      solved: stats.solved,
      ranking: stats.ranking,
      streak: stats.streak,
      totalActiveDays: stats.totalActiveDays,
      weakestTopics: buildCoverageSummary(topicNeeds),
    },
    daily: daily
      ? {
          slug: daily.slug,
          title: daily.title,
          difficulty: daily.difficulty,
          url: daily.link || `https://leetcode.com/problems/${daily.slug}/`,
          status: daily.status || null,
          tags: daily.tags || [],
        }
      : null,
    recommendation,
    limitations,
  };
}

function dailyStatusLabel(daily, verified) {
  if (!daily) return null;
  if (!verified) return 'status unknown';
  if (daily.status === 'ac') return 'solved';
  if (daily.status === 'notac') return 'attempted, unsolved';
  return 'not started';
}

/**
 * Plain-text message fragment used by Telegram and the CLI.
 */
function formatRecommendation(result, { includeDaily = true, includeWhy = true } = {}) {
  const lines = [];

  if (includeDaily && result.daily) {
    const isAlsoRecommendation = result.recommendation?.slug === result.daily.slug;
    if (!isAlsoRecommendation) {
      const status = dailyStatusLabel(result.daily, result.verified);
      lines.push(
        `📅 Today's challenge: ${result.daily.title} (${result.daily.difficulty})${status ? ` — ${status}` : ''}`
      );
      lines.push(result.daily.url);
    }
  }

  if (!result.recommendation) {
    lines.push('No recommendation available right now.');
    return lines.join('\n');
  }

  const rec = result.recommendation;
  if (lines.length > 0) lines.push('');
  lines.push(`🎯 Recommended: ${rec.title} (${rec.difficulty})`);

  if (includeWhy) {
    lines.push(`Concept: ${rec.concept}`);
    lines.push(`Why: ${rec.reason}`);
  }

  lines.push(rec.url);
  return lines.join('\n');
}

module.exports = {
  TAG_IMPORTANCE,
  TAG_LABELS,
  DIFFICULTY_FIT,
  FALLBACK_TOPIC_TOTALS,
  FALLBACK_TAG_SOLVED,
  DEDUPE_WINDOW_DAYS,
  topicLabel,
  buildTopicNeeds,
  catalogTags,
  wasRecommendedRecently,
  buildCandidates,
  scoreCandidate,
  pickRecommendation,
  buildReason,
  recommend,
  formatRecommendation,
  dailyStatusLabel,
};
