/**
 * Cloudflare Worker scheduler for the LeetCode Streak Guardian.
 *
 * GitHub's own `schedule` trigger delays and drops runs under load, so a
 * Cloudflare Cron Trigger starts the workflow through the GitHub API instead.
 * The bot itself still runs in GitHub Actions; this Worker only dispatches it.
 */

const GITHUB_API_VERSION = '2022-11-28';
const DISPATCH_TIMEOUT_MS = 10_000;

function dispatchUrl(owner, repo, workflow) {
  const segments = [owner, repo, 'actions', 'workflows', workflow, 'dispatches']
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `https://api.github.com/repos/${segments}`;
}

function readConfig(env) {
  const owner = env.GITHUB_OWNER?.trim();
  const repo = env.GITHUB_REPO?.trim();
  const workflow = env.GITHUB_WORKFLOW?.trim();

  if (!owner || !repo || !workflow) {
    throw new Error(
      'Missing GITHUB_OWNER, GITHUB_REPO, or GITHUB_WORKFLOW in scheduler/wrangler.jsonc.'
    );
  }

  if (!env.GITHUB_TOKEN) {
    throw new Error(
      'Missing GITHUB_TOKEN secret. Run: npx wrangler secret put GITHUB_TOKEN'
    );
  }

  return {
    owner,
    repo,
    workflow,
    ref: env.GITHUB_REF?.trim() || 'main',
    token: env.GITHUB_TOKEN,
  };
}

/**
 * Asks GitHub to run the guardian workflow once. Returns the dispatch details
 * or throws with the API response so failures show up in `wrangler tail`.
 */
export async function dispatchGuardian(env, fetchImpl = fetch) {
  const { owner, repo, workflow, ref, token } = readConfig(env);

  const response = await fetchImpl(dispatchUrl(owner, repo, workflow), {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'leetcode-streak-guardian-scheduler',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    },
    body: JSON.stringify({ ref }),
    signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
  });

  if (response.status !== 204) {
    const detail = (await response.text()).slice(0, 500).trim();
    throw new Error(
      `GitHub dispatch failed: ${response.status} ${response.statusText}` +
        (detail ? ` - ${detail}` : '')
    );
  }

  return { owner, repo, workflow, ref, status: response.status };
}

export default {
  async scheduled(controller, env) {
    const result = await dispatchGuardian(env);
    const at = new Date(controller.scheduledTime).toISOString();

    console.log(
      `Dispatched ${result.owner}/${result.repo} ${result.workflow}@${result.ref} ` +
        `(cron "${controller.cron}", scheduled ${at})`
    );
  },

  async fetch() {
    return Response.json({
      service: 'leetcode-streak-guardian-scheduler',
      ok: true,
      note: 'Runs on a Cron Trigger only. See the repository Actions tab for dispatched runs.',
    });
  },
};
