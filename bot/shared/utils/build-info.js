/**
 * Which commit is this process running?
 *
 * Exposed on /health so an E2E runner can refuse to drive a build that is not the commit it
 * was asked to test. Locally the E2E stack launcher sets E2E_COMMIT_SHA from the detached
 * worktree it started the bot from; on Railway the platform sets RAILWAY_GIT_COMMIT_SHA.
 * Null when neither is known — never a placeholder, so a comparison against a real sha
 * cannot accidentally pass.
 */
function commitSha(env = process.env) {
  for (const k of ['E2E_COMMIT_SHA', 'RAILWAY_GIT_COMMIT_SHA']) {
    const v = typeof env[k] === 'string' ? env[k].trim() : '';
    if (v) return v;
  }
  return null;
}

module.exports = { commitSha };
