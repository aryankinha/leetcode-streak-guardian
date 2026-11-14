import assert from 'node:assert/strict';
import test from 'node:test';

import worker, { dispatchGuardian } from '../src/index.js';

const baseEnv = {
  GITHUB_OWNER: 'aryankinha',
  GITHUB_REPO: 'leetcode-streak-guardian',
  GITHUB_WORKFLOW: 'guardian.yml',
  GITHUB_REF: 'main',
  GITHUB_TOKEN: 'test-token',
};

test('dispatches the configured workflow on the default branch', async () => {
  let captured = null;
  const fakeFetch = async (url, init) => {
    captured = { url, init };
    return new Response(null, { status: 204 });
  };

  const result = await dispatchGuardian(baseEnv, fakeFetch);

  assert.equal(
    captured.url,
    'https://api.github.com/repos/aryankinha/leetcode-streak-guardian/actions/workflows/guardian.yml/dispatches'
  );
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers.Authorization, 'Bearer test-token');
  assert.equal(captured.init.headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.deepEqual(JSON.parse(captured.init.body), { ref: 'main' });
  assert.equal(result.status, 204);
});

test('surfaces GitHub errors with status and response body', async () => {
  const fakeFetch = async () =>
    new Response(JSON.stringify({ message: 'Bad credentials' }), {
      status: 401,
      statusText: 'Unauthorized',
    });

  await assert.rejects(
    () => dispatchGuardian(baseEnv, fakeFetch),
    /GitHub dispatch failed: 401 Unauthorized.*Bad credentials/
  );
});

test('fails clearly when the token is missing', async () => {
  await assert.rejects(
    () => dispatchGuardian({ ...baseEnv, GITHUB_TOKEN: '' }, fetch),
    /GITHUB_TOKEN secret/
  );
});

test('scheduled handler dispatches exactly once', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, { status: 204 });
  };

  try {
    await worker.scheduled(
      { cron: '*/10 4-23 * * *', scheduledTime: Date.now() },
      baseEnv
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls, 1);
});
