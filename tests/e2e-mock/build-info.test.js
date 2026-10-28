/**
 * build-info — which commit is this process running?
 *
 * `/health` exposes it so an E2E runner can refuse to drive a build that is not the commit
 * it was asked to test. Locally the stack launcher sets E2E_COMMIT_SHA from the detached
 * worktree it started the bot from; on Railway the platform sets RAILWAY_GIT_COMMIT_SHA.
 *
 * Red-first: fails on develop — the module does not exist.
 */
const { commitSha } = require('../../bot/shared/utils/build-info');

describe('build-info.commitSha', () => {
  test('prefers E2E_COMMIT_SHA (a local run from a pinned worktree)', () => {
    expect(commitSha({ E2E_COMMIT_SHA: 'a'.repeat(40), RAILWAY_GIT_COMMIT_SHA: 'b'.repeat(40) })).toBe('a'.repeat(40));
  });
  test('falls back to RAILWAY_GIT_COMMIT_SHA on a deployed service', () => {
    expect(commitSha({ RAILWAY_GIT_COMMIT_SHA: 'b'.repeat(40) })).toBe('b'.repeat(40));
  });
  test('is null when neither is set, never a placeholder string', () => {
    expect(commitSha({})).toBeNull();
    expect(commitSha({ E2E_COMMIT_SHA: '   ' })).toBeNull();
  });
});
