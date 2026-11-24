const assert = require('assert');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { PROBLEM_CATALOG } = require('../src/problemCatalog');
const recommender = require('../src/recommender');
const reminderEngine = require('../src/reminderEngine');
const store = require('../src/recommendationStore');

const USERNAME = 'aryankinha';

function baseStats(overrides = {}) {
  return {
    username: USERNAME,
    ranking: 144434,
    streak: 171,
    totalActiveDays: 361,
    solved: { All: 607, Easy: 310, Medium: 273, Hard: 24 },
    tagSolved: {
      'heap-priority-queue': 15,
      'design': 2,
      'trie': 2,
      'sliding-window': 17,
      'graph': 20,
      'dynamic-programming': 61,
      'array': 285,
      'string': 109,
    },
    ...overrides,
  };
}

function totals(overrides = {}) {
  return {
    ...recommender.FALLBACK_TOPIC_TOTALS,
    'heap-priority-queue': 100,
    'design': 100,
    'trie': 100,
    'sliding-window': 100,
    'graph': 100,
    'dynamic-programming': 100,
    'array': 100,
    ...overrides,
  };
}

function catalog() {
  return [
    {
      slug: 'solved-problem',
      title: 'Solved Problem',
      difficulty: 'Medium',
      primaryTag: 'heap-priority-queue',
      tags: ['heap-priority-queue'],
      concept: 'Solved concept',
      why: 'Already solved',
      priority: 1,
    },
    {
      slug: 'weak-problem',
      title: 'Weak Problem',
      difficulty: 'Medium',
      primaryTag: 'design',
      tags: ['design'],
      concept: 'Design concept',
      why: 'Weak topic',
      priority: 2,
    },
    {
      slug: 'strong-problem',
      title: 'Strong Problem',
      difficulty: 'Medium',
      primaryTag: 'array',
      tags: ['array'],
      concept: 'Array concept',
      why: 'Strong topic',
      priority: 3,
    },
  ];
}

function details(overrides = {}) {
  return {
    'solved-problem': { status: 'ac', tags: ['heap-priority-queue'] },
    'weak-problem': { status: null, tags: ['design'] },
    'strong-problem': { status: null, tags: ['array'] },
    ...overrides,
  };
}

function daily(overrides = {}) {
  return {
    date: '2026-11-24',
    slug: 'daily-problem',
    title: 'Daily Problem',
    difficulty: 'Medium',
    status: null,
    tags: ['array'],
    link: 'https://leetcode.com/problems/daily-problem/',
    ...overrides,
  };
}

function recommendArgs(overrides = {}) {
  return {
    username: USERNAME,
    now: new Date('2026-11-24T12:00:00Z'),
    history: [],
    catalog: catalog(),
    fetchStats: async () => baseStats(),
    fetchTopicTotals: async () => totals(),
    fetchDetails: async (slugs) => details(),
    fetchSession: async () => ({ signedIn: true, configured: true, username: USERNAME }),
    fetchRecent: async () => [],
    fetchDaily: async () => daily(),
    ...overrides,
  };
}

async function runTests() {
  console.log('====================================================');
  console.log('     LeetCode Recommendation Engine — Test Suite     ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  PASS: ${name}`);
      passed += 1;
    } catch (error) {
      console.error(`  FAIL: ${name}`);
      console.error(`        ${error.stack || error.message}`);
      failed += 1;
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`  PASS: ${name}`);
      passed += 1;
    } catch (error) {
      console.error(`  FAIL: ${name}`);
      console.error(`        ${error.stack || error.message}`);
      failed += 1;
    }
  }

  try {
    console.log('--- Topic needs ---');
    test('coverage and need are computed from solved and total counts', () => {
      const needs = recommender.buildTopicNeeds(
        { 'heap-priority-queue': 15, 'design': 2 },
        { 'heap-priority-queue': 223, 'design': 100 }
      );

      assert.strictEqual(needs['heap-priority-queue'].solved, 15);
      assert.strictEqual(needs['heap-priority-queue'].total, 223);
      assert(needs['heap-priority-queue'].coverage > 0.06);
      assert(needs['heap-priority-queue'].coverage < 0.07);
      assert.strictEqual(needs['design'].coverage, 0.02);
      assert.strictEqual(needs['design'].need, 0.98);
    });

    test('unknown tags are skipped instead of being assumed zero', () => {
      const needs = recommender.buildTopicNeeds({}, { 'graph': 190 });
      assert.strictEqual(needs.graph, undefined);
    });

    test('a known tag with zero solved still counts as zero', () => {
      const needs = recommender.buildTopicNeeds({ graph: 0 }, { graph: 190 });
      assert.strictEqual(needs.graph.coverage, 0);
      assert.strictEqual(needs.graph.need, 1);
    });

    test('a zero total does not divide by zero', () => {
      const needs = recommender.buildTopicNeeds({ graph: 5 }, { graph: 0 });
      assert.strictEqual(needs.graph.coverage, 0);
      assert.strictEqual(needs.graph.need, 1);
    });

    console.log('\n--- Candidate selection ---');
    test('solved problems are excluded when status is verified', async () => {
      const result = await recommender.recommend(recommendArgs());
      assert(result.recommendation);
      assert.notStrictEqual(result.recommendation.slug, 'solved-problem');
    });

    test('the weakest topic wins when difficulty and status are equal', async () => {
      const result = await recommender.recommend(recommendArgs());
      assert.strictEqual(result.recommendation.slug, 'weak-problem');
      assert.strictEqual(result.recommendation.primaryTag, 'design');
      assert(result.recommendation.reason.includes('Design'));
    });

    test('a recent recommendation is skipped in favour of the next candidate', async () => {
      const result = await recommender.recommend(
        recommendArgs({
          history: [{ slug: 'weak-problem', date: '2026-11-23' }],
        })
      );

      assert.notStrictEqual(result.recommendation.slug, 'weak-problem');
    });

    test("today's own pick does not count as a repeat, so the day stays stable", async () => {
      const result = await recommender.recommend(
        recommendArgs({
          history: [{ slug: 'weak-problem', date: '2026-11-24' }],
        })
      );

      assert.strictEqual(result.recommendation.slug, 'weak-problem');
    });

    test('an attempted-but-unsolved problem is labelled as a retry', async () => {
      const result = await recommender.recommend(
        recommendArgs({
          fetchDetails: async () => ({
            'solved-problem': { status: 'ac', tags: ['heap-priority-queue'] },
            'weak-problem': { status: 'notac', tags: ['design'] },
            'strong-problem': { status: null, tags: ['array'] },
          }),
        })
      );

      assert.strictEqual(result.recommendation.slug, 'weak-problem');
      assert.strictEqual(result.recommendation.status, 'retry');
      assert(result.recommendation.reason.includes('attempted this before'));
    });

    console.log('\n--- Daily challenge integration ---');
    test('an unsolved daily gets a score bonus and can win', async () => {
      const args = recommendArgs({
        catalog: [
          {
            slug: 'strong-problem',
            title: 'Strong Problem',
            difficulty: 'Medium',
            primaryTag: 'array',
            tags: ['array'],
            concept: 'Array concept',
            why: 'Strong topic',
            priority: 1,
          },
        ],
        fetchDetails: async () => ({
          'strong-problem': { status: null, tags: ['array'] },
          'daily-problem': { status: null, tags: ['array'] },
        }),
      });

      const result = await recommender.recommend(args);
      assert.strictEqual(result.recommendation.slug, 'daily-problem');
      assert.strictEqual(result.recommendation.isDaily, true);
      assert(result.recommendation.reason.includes("Today's challenge"));

      const message = recommender.formatRecommendation(result);
      assert(message.includes('Recommended: Daily Problem'));
      assert(!message.includes('📅 Today\'s challenge'));
    });

    test('a solved daily gets no bonus and is not recommended', async () => {
      const result = await recommender.recommend(
        recommendArgs({ fetchDaily: async () => daily({ status: 'ac' }) })
      );

      assert.strictEqual(result.daily.status, 'ac');
      assert.notStrictEqual(result.recommendation.isDaily, true);
    });

    console.log('\n--- Unverified mode ---');
    await testAsync('without a session, status is unverified and disclosed', async () => {
      const result = await recommender.recommend(
        recommendArgs({
          fetchSession: async () => ({ signedIn: false, configured: false, username: null }),
          fetchDetails: async () => details({
            'solved-problem': { status: null, tags: ['heap-priority-queue'] },
          }),
        })
      );

      assert.strictEqual(result.verified, false);
      assert(result.limitations.some((line) => line.includes('LEETCODE_SESSION')));
      assert(result.recommendation);
    });

    await testAsync('without a session, recently accepted problems are excluded', async () => {
      const result = await recommender.recommend(
        recommendArgs({
          fetchSession: async () => ({ signedIn: false, configured: false, username: null }),
          fetchRecent: async () => [
            {
              slug: 'weak-problem',
              title: 'Weak Problem',
              accepted: true,
              statusDisplay: 'Accepted',
              timestamp: 0,
            },
          ],
        })
      );

      assert.notStrictEqual(result.recommendation.slug, 'weak-problem');
    });

    await testAsync('a session for another user is rejected', async () => {
      const result = await recommender.recommend(
        recommendArgs({
          fetchSession: async () => ({ signedIn: true, configured: true, username: 'someone-else' }),
        })
      );

      assert.strictEqual(result.verified, false);
      assert(result.limitations.some((line) => line.includes('someone-else')));
    });

    console.log('\n--- Output ---');
    await testAsync('the message contains both the daily challenge and one recommendation', async () => {
      const result = await recommender.recommend(recommendArgs());
      const message = recommender.formatRecommendation(result);

      assert(message.includes("Today's challenge: Daily Problem (Medium)"));
      assert(message.includes('Recommended: Weak Problem (Medium)'));
      assert(message.includes('https://leetcode.com/problems/weak-problem/'));
      assert(!message.includes('Recommended: Strong Problem'));
      assert(!message.includes('*'));
    });

    test('the daily status is labelled correctly', () => {
      assert.strictEqual(
        recommender.dailyStatusLabel({ status: 'ac' }, true),
        'solved'
      );
      assert.strictEqual(
        recommender.dailyStatusLabel({ status: 'notac' }, true),
        'attempted, unsolved'
      );
      assert.strictEqual(
        recommender.dailyStatusLabel({ status: null }, true),
        'not started'
      );
      assert.strictEqual(
        recommender.dailyStatusLabel({ status: null }, false),
        'status unknown'
      );
    });

    test('the reminder includes the recommendation link and no extra summary', () => {
      const ist = reminderEngine.getISTParts(new Date('2026-11-24T04:30:00Z'));
      const recommendation = {
        verified: true,
        daily: { slug: 'daily-problem' },
        recommendation: {
          slug: 'weak-problem',
          title: 'Weak Problem',
          difficulty: 'Medium',
          concept: 'Design concept',
          url: 'https://leetcode.com/problems/weak-problem/',
        },
      };

      const message = reminderEngine.buildReminderMessage({
        window: reminderEngine.WINDOW.DAYTIME,
        ist,
        dcc: null,
        recommendation,
      });

      assert(message.includes('🎯 Next: Weak Problem (Medium)'));
      assert(message.includes('https://leetcode.com/problems/weak-problem/'));
      assert(!message.includes('Design concept'));

      const duplicate = reminderEngine.buildReminderMessage({
        window: reminderEngine.WINDOW.DAYTIME,
        ist,
        dcc: null,
        recommendation: {
          ...recommendation,
          daily: { slug: 'weak-problem' },
        },
      });
      assert(!duplicate.includes('🎯 Next:'));

      const unverified = reminderEngine.buildReminderMessage({
        window: reminderEngine.WINDOW.EVENING,
        ist,
        dcc: null,
        recommendation: { ...recommendation, verified: false },
      });
      assert(unverified.includes('🎯 Next: Weak Problem (Medium)'));
      assert(unverified.includes('https://leetcode.com/problems/weak-problem/'));
      assert(!unverified.includes('unverified'));
    });

    console.log('\n--- Catalog integrity ---');
    test('catalog slugs are unique and metadata is complete', () => {
      const slugs = PROBLEM_CATALOG.map((problem) => problem.slug);
      assert.strictEqual(new Set(slugs).size, slugs.length, 'duplicate catalog slug');

      for (const problem of PROBLEM_CATALOG) {
        assert(problem.title, `${problem.slug} has no title`);
        assert(['Easy', 'Medium', 'Hard'].includes(problem.difficulty), `${problem.slug} bad difficulty`);
        assert(problem.tags.length > 0, `${problem.slug} has no tags`);
        assert(problem.tags.includes(problem.primaryTag), `${problem.slug} primaryTag not in tags`);
        assert(problem.concept, `${problem.slug} has no concept`);
        assert(problem.why, `${problem.slug} has no rationale`);
      }
    });

    console.log('\n--- Recommendation store ---');
    const originalPath = config.paths.runtimeRecommendation;
    const tempPath = path.join(
      config.paths.runtimeDir,
      `recommendation-test-${process.pid}.json`
    );
    config.paths.runtimeRecommendation = tempPath;

    try {
      test('remembering a result records one history entry', () => {
        const initial = store.defaultStore();
        const result = {
          recommendation: { slug: 'weak-problem', title: 'Weak Problem' },
          generatedAt: '2026-11-24T12:00:00.000Z',
        };

        const next = store.rememberResult(initial, {
          date: '2026-11-24',
          username: USERNAME,
          result,
          now: new Date('2026-11-24T12:00:00Z'),
        });

        assert.strictEqual(next.history.length, 1);
        assert.strictEqual(next.history[0].slug, 'weak-problem');
        assert.strictEqual(next.today.date, '2026-11-24');
      });

      test('re-recording the same slug does not duplicate history', () => {
        let saved = store.rememberResult(store.defaultStore(), {
          date: '2026-11-23',
          username: USERNAME,
          result: { recommendation: { slug: 'weak-problem', title: 'Weak Problem' } },
          now: new Date('2026-11-23T12:00:00Z'),
        });

        saved = store.rememberResult(saved, {
          date: '2026-11-24',
          username: USERNAME,
          result: { recommendation: { slug: 'weak-problem', title: 'Weak Problem' } },
          now: new Date('2026-11-24T12:00:00Z'),
        });

        assert.strictEqual(saved.history.length, 1);
        assert.strictEqual(saved.history[0].date, '2026-11-24');
      });

      test('the cache expires after six hours', () => {
        const saved = store.rememberResult(store.defaultStore(), {
          date: '2026-11-24',
          username: USERNAME,
          result: {
            recommendation: { slug: 'weak-problem', title: 'Weak Problem' },
            generatedAt: '2026-11-24T00:00:00.000Z',
          },
          now: new Date('2026-11-24T00:00:00Z'),
        });

        const fresh = store.getCachedResult(saved, {
          date: '2026-11-24',
          username: USERNAME,
          now: new Date('2026-11-24T05:00:00Z'),
        });
        assert(fresh);

        const stale = store.getCachedResult(saved, {
          date: '2026-11-24',
          username: USERNAME,
          now: new Date('2026-11-24T07:00:00Z'),
        });
        assert.strictEqual(stale, null);
      });

      test('save and load round-trip through disk', () => {
        const saved = store.rememberResult(store.defaultStore(), {
          date: '2026-11-24',
          username: USERNAME,
          result: {
            recommendation: { slug: 'weak-problem', title: 'Weak Problem' },
            generatedAt: '2026-11-24T12:00:00.000Z',
          },
          now: new Date('2026-11-24T12:00:00Z'),
        });

        store.saveStore(saved);
        const loaded = store.loadStore();
        assert.strictEqual(loaded.history.length, 1);
        assert.strictEqual(loaded.today.result.recommendation.slug, 'weak-problem');
      });

      test('an unverified cache is ignored once a session is configured', () => {
        const saved = store.rememberResult(store.defaultStore(), {
          date: '2026-11-24',
          username: USERNAME,
          result: {
            verified: false,
            recommendation: { slug: 'weak-problem', title: 'Weak Problem' },
            generatedAt: '2026-11-24T12:00:00.000Z',
          },
          now: new Date('2026-11-24T12:00:00Z'),
        });

        const originalSession = config.leetcode.session;
        try {
          assert(store.getCachedResult(saved, {
            date: '2026-11-24',
            username: USERNAME,
            now: new Date('2026-11-24T13:00:00Z'),
          }));

          config.leetcode.session = 'test-session';
          assert.strictEqual(
            store.getCachedResult(saved, {
              date: '2026-11-24',
              username: USERNAME,
              now: new Date('2026-11-24T13:00:00Z'),
            }),
            null
          );
        } finally {
          config.leetcode.session = originalSession;
        }
      });

      test('history within the window counts as a recent recommendation', () => {
        assert.strictEqual(
          recommender.wasRecommendedRecently(
            [{ slug: 'weak-problem', date: '2026-11-20' }],
            'weak-problem',
            new Date('2026-11-24T12:00:00Z')
          ),
          true
        );
        assert.strictEqual(
          recommender.wasRecommendedRecently(
            [{ slug: 'weak-problem', date: '2026-10-01' }],
            'weak-problem',
            new Date('2026-11-24T12:00:00Z')
          ),
          false
        );
      });
    } finally {
      config.paths.runtimeRecommendation = originalPath;
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  } finally {
    console.log('\n[INFO] Recommendation test files cleaned up.');
  }

  console.log('\n====================================================');
  console.log(`Test Summary: ${passed} passed, ${failed} failed`);
  console.log('====================================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
