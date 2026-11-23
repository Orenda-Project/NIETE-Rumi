/**
 * scripts/ci/promotion-invariant.sh: the post-hoc backstop for the promotion ladder.
 *
 * The per-PR gates (`main needs staging`, `staging needs sandbox`) refuse a bad PR at the
 * door, but a bypass actor can merge past them. This backstop runs AFTER a push has landed on
 * a protected branch and asks the SAME provenance question over the whole branch: does
 * <downstream> carry any commit <upstream> does not already have, by the needs-upstream.sh
 * tests (ancestor / -x trailer / patch-id / byte-identical files)? A commit graph cannot be
 * quietly rewritten under branch protection, so an ignored red run is still a permanent record.
 *
 * It replaces `git merge-tree --write-tree <upstream> <downstream>`, which assumed lane A
 * (<downstream> promoted from <upstream> as a whole branch, so the trees must match). Under
 * lane B (agreed 2026-11-04, bd-mft11s) the two branches hold different SUBSETS of the same
 * work and their trees legitimately differ, so merge-tree went red on every honest pick.
 *
 * Same throwaway-repo harness as needs-upstream.test.js: a bare origin under the OS temp dir,
 * the script run under `bash -eo pipefail`, the shell GitHub Actions uses for `run:` steps.
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '../../scripts/ci/promotion-invariant.sh');

// No user or system git config: hooks, signing or a global hooksPath must not leak in.
const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

const tmpRoots = [];
afterAll(() => {
  for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true });
});

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    env: ENV,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function write(cwd, file, text) {
  fs.writeFileSync(path.join(cwd, file), text);
}

function commit(cwd, file, text, msg) {
  write(cwd, file, text);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', msg);
  return git(cwd, 'rev-parse', 'HEAD');
}

/** Finish a conflicted cherry-pick without opening an editor. */
function continueCherryPick(cwd) {
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'cherry-pick', '--continue'], {
    cwd,
    env: { ...ENV, GIT_EDITOR: 'true' },
    stdio: 'ignore',
  });
}

function invariant(work, upstream, downstream) {
  const r = spawnSync('bash', ['-eo', 'pipefail', SCRIPT, upstream, downstream], {
    cwd: work,
    env: ENV,
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function publish(work, branch) {
  git(work, 'push', '-q', 'origin', `HEAD:${branch}`);
  git(work, 'fetch', '-q', 'origin');
}

/** origin: main = base; staging = base + S1 + S2 + S3. No stray main-only commit. */
function makeMainRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promotion-invariant-'));
  tmpRoots.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'init', '-q', '-b', 'main', work);
  git(work, 'remote', 'add', 'origin', origin);

  commit(work, 'base.txt', 'base\n', 'base');
  git(work, 'push', '-q', 'origin', 'main');

  git(work, 'checkout', '-q', '-b', 'staging', 'main');
  const S1 = commit(work, 's.txt', 'A\n', 'S1 feature A');
  const S2 = commit(work, 's.txt', 'A\nB\n', 'S2 feature B');
  const S3 = commit(work, 's.txt', 'A\nB\nC\n', 'S3 feature C');
  git(work, 'push', '-q', 'origin', 'staging');

  git(work, 'checkout', '-q', 'main');
  git(work, 'fetch', '-q', 'origin');
  return { work, S1, S2, S3 };
}

/** origin: main = base; sandbox = base + X1; staging = base + (cherry-pick -x X1). */
function makeLadderRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promotion-invariant-ladder-'));
  tmpRoots.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'init', '-q', '-b', 'main', work);
  git(work, 'remote', 'add', 'origin', origin);

  commit(work, 'base.txt', 'base\n', 'base');
  git(work, 'push', '-q', 'origin', 'main');

  git(work, 'checkout', '-q', '-b', 'sandbox', 'main');
  const X1 = commit(work, 'x.txt', 'sandbox feature\n', 'X1 sandbox feature');
  git(work, 'push', '-q', 'origin', 'sandbox');

  git(work, 'checkout', '-q', '-b', 'staging', 'main');
  git(work, 'cherry-pick', '-x', X1); // clean: staging lacks x.txt
  git(work, 'push', '-q', 'origin', 'staging');

  git(work, 'fetch', '-q', 'origin');
  return { work, X1 };
}

describe('promotion-invariant.sh: a downstream branch carries nothing that skipped its upstream', () => {
  test('main that only cherry-picked staging passes', () => {
    const repo = makeMainRepo();
    git(repo.work, 'checkout', '-q', '-B', 'main', 'origin/main');
    git(repo.work, 'cherry-pick', '-x', repo.S1);
    publish(repo.work, 'main');
    const r = invariant(repo.work, 'origin/staging', 'origin/main');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/nothing that skipped/i);
  });

  test('an EDITED lane-B pick passes on its trailer though the trees differ (the merge-tree bug)', () => {
    const repo = makeMainRepo();
    git(repo.work, 'checkout', '-q', '-B', 'main', 'origin/main');
    // S2 assumes S1, which main lacks, so the pick conflicts and is resolved by hand. The result
    // matches no staging patch and no staging file byte-for-byte: only the `(cherry picked from
    // commit S2)` trailer can vouch for it — the exact case merge-tree reported as a conflict.
    let threw = false;
    try {
      git(repo.work, 'cherry-pick', '-x', repo.S2);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    write(repo.work, 's.txt', 'B\n');
    git(repo.work, 'add', 's.txt');
    continueCherryPick(repo.work);
    expect(git(repo.work, 'log', '-1', '--format=%B')).toContain(`cherry picked from commit ${repo.S2}`);
    publish(repo.work, 'main');
    // The branches' trees genuinely differ here, so the old merge-tree check WOULD have failed.
    expect(git(repo.work, 'rev-parse', 'origin/main^{tree}')).not.toBe(git(repo.work, 'rev-parse', 'origin/staging^{tree}'));
    const r = invariant(repo.work, 'origin/staging', 'origin/main');
    expect(r.code).toBe(0);
  });

  test('a commit that reached main without a staging source fails, is named, and warns against a back-merge', () => {
    const repo = makeMainRepo();
    git(repo.work, 'checkout', '-q', '-B', 'main', 'origin/main');
    git(repo.work, 'cherry-pick', '-x', repo.S1); // a good pick, must not be blamed
    commit(repo.work, 'h.txt', 'written straight on main\n', 'hotfix straight to main');
    publish(repo.work, 'main');
    const r = invariant(repo.work, 'origin/staging', 'origin/main');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/hotfix straight to main/);
    expect(r.out).toMatch(/back-merge/i);
    expect(r.out).not.toMatch(/S1 feature A$/m); // the good pick is not blamed
  });

  test('lane A: main fast-forwarded to staging passes', () => {
    const repo = makeMainRepo();
    git(repo.work, 'checkout', '-q', '-B', 'main', 'origin/staging');
    publish(repo.work, 'main');
    const r = invariant(repo.work, 'origin/staging', 'origin/main');
    expect(r.code).toBe(0);
  });

  test('the SAME rule guards the lower rung: staging carrying content sandbox lacks fails', () => {
    const repo = makeLadderRepo();
    // Clean to start: staging is sourced from sandbox.
    expect(invariant(repo.work, 'origin/sandbox', 'origin/staging').code).toBe(0);

    git(repo.work, 'checkout', '-q', '-B', 'staging', 'origin/staging');
    commit(repo.work, 'g.txt', 'straight on staging\n', 'feature straight on staging');
    publish(repo.work, 'staging');
    const r = invariant(repo.work, 'origin/sandbox', 'origin/staging');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/feature straight on staging/);
    expect(r.out).not.toMatch(/X1 sandbox feature/); // the sourced pick is not blamed
  });

  test('an unresolvable ref is a CI problem (exit 2), never a pass', () => {
    const repo = makeMainRepo();
    const r = invariant(repo.work, 'origin/staging', 'origin/does-not-exist');
    expect(r.code).toBe(2);
  });
});
