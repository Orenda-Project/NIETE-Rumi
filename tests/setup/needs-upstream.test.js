/**
 * scripts/ci/needs-upstream.sh: the provenance rule behind `main needs staging`.
 *
 * The ladder is sandbox -> staging -> main, one rung at a time. A PR into `main` may
 * only carry commits `staging` already has, however they arrive: the `staging` branch
 * itself (lane A), or per-feature `git cherry-pick -x` picks onto a branch off `main`
 * (lane B). Agreed 2026-11-04 (bd-mft11s), after ~20 features reached production before
 * staging while nothing enforced the order.
 *
 * Every case builds a throwaway repo with a bare origin under the OS temp dir, so it
 * never touches this clone, and runs the script under `bash -eo pipefail`, the shell
 * GitHub Actions uses for `run:` steps (plain `bash` hid a failure once: bd-w7t4f).
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '../../scripts/ci/needs-upstream.sh');

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

/**
 * origin has three branches cut from one base:
 *   main     base
 *   staging  base + S1 (adds s.txt "A") + S2 ("A B") + S3 ("A B C")
 *   sandbox  base + X1 (adds x.txt), a change staging never took
 */
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'needs-upstream-'));
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

  git(work, 'checkout', '-q', '-b', 'sandbox', 'main');
  const X1 = commit(work, 'x.txt', 'sandbox only\n', 'X1 sandbox-only work');
  git(work, 'push', '-q', 'origin', 'sandbox');

  // main moves on, so a pick lands on a different parent than the original. Picked onto the
  // SAME parent within the same second, git rebuilds the identical commit (same SHA), the
  // ancestor test accepts it, and the patch-id path is never exercised.
  git(work, 'checkout', '-q', 'main');
  commit(work, 'm.txt', 'main moved on\n', 'M1 main moved on');
  git(work, 'push', '-q', 'origin', 'main');

  git(work, 'fetch', '-q', 'origin');
  return { work, S1, S2, S3, X1 };
}

/** A PR branch cut from origin/main, the way lane B starts. */
function prBranch(repo, name) {
  git(repo.work, 'checkout', '-q', '-b', name, 'origin/main');
}

function check(repo, head, base = git(repo.work, 'rev-parse', 'origin/main')) {
  const r = spawnSync('bash', ['-eo', 'pipefail', SCRIPT, 'origin/staging', base, head], {
    cwd: repo.work,
    env: ENV,
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const head = (repo) => git(repo.work, 'rev-parse', 'HEAD');

describe('needs-upstream.sh: a PR into main may only carry what staging has', () => {
  test('lane A: a PR whose head is staging passes', () => {
    const repo = makeRepo();
    const r = check(repo, git(repo.work, 'rev-parse', 'origin/staging'));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/already on 'staging'/);
  });

  test('lane B: a `cherry-pick -x` of a staging commit passes on its trailer alone', () => {
    const repo = makeRepo();
    prBranch(repo, 'feature-b-main');
    // S2 assumes S1, which main lacks, so the pick conflicts and is resolved by hand. The
    // result's patch matches no staging commit and its file matches staging's neither:
    // only the `(cherry picked from commit S2)` trailer can vouch for it.
    expect(() => git(repo.work, 'cherry-pick', '-x', repo.S2)).toThrow();
    write(repo.work, 's.txt', 'B\n');
    git(repo.work, 'add', 's.txt');
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'cherry-pick', '--continue'], {
      cwd: repo.work,
      env: { ...ENV, GIT_EDITOR: 'true' },
      stdio: 'ignore',
    });
    expect(git(repo.work, 'log', '-1', '--format=%B')).toContain(`cherry picked from commit ${repo.S2}`);
    const r = check(repo, head(repo));
    expect(r.code).toBe(0);
  });

  test('a pick done without -x still passes when staging has the same patch', () => {
    const repo = makeRepo();
    prBranch(repo, 'feature-a-main');
    git(repo.work, 'cherry-pick', repo.S1);
    expect(head(repo)).not.toBe(repo.S1); // a new commit, so only the patch-id can vouch for it
    expect(git(repo.work, 'log', '-1', '--format=%B')).not.toMatch(/cherry picked from/);
    const r = check(repo, head(repo));
    expect(r.code).toBe(0);
  });

  test('a commit written on the PR branch itself fails, and is named', () => {
    const repo = makeRepo();
    prBranch(repo, 'hotfix-main');
    git(repo.work, 'cherry-pick', '-x', repo.S1);
    commit(repo.work, 'h.txt', 'written straight on the main branch\n', 'hotfix straight to main');
    const r = check(repo, head(repo));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/not on 'staging'/);
    expect(r.out).toMatch(/hotfix straight to main/);
    expect(r.out).not.toMatch(/S1 feature A$/m); // the good pick is not blamed
  });

  test('a -x trailer naming a sandbox-only commit fails: sandbox -> main skips a rung', () => {
    const repo = makeRepo();
    prBranch(repo, 'sandbox-pick-main');
    git(repo.work, 'cherry-pick', '-x', repo.X1);
    const r = check(repo, head(repo));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/X1 sandbox-only work/);
  });

  test('merge commits in the PR are skipped; the commits they bring are still judged', () => {
    const repo = makeRepo();
    prBranch(repo, 'lane-a-via-branch');
    git(repo.work, 'merge', '-q', '--no-ff', '-m', 'merge staging into the promotion branch', 'origin/staging');
    const merged = check(repo, head(repo));
    expect(merged.code).toBe(0);
    // skipped, not judged: a merge must never be waved through as an "integration commit"
    expect(merged.out).not.toMatch(/merge staging into the promotion branch/);

    commit(repo.work, 'h.txt', 'extra\n', 'extra change after the merge');
    const r = check(repo, head(repo));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/extra change after the merge/);
  });

  test("an integration commit whose files end byte-identical to staging's passes, and is listed", () => {
    const repo = makeRepo();
    prBranch(repo, 'feature-abc-main');
    git(repo.work, 'cherry-pick', '-x', repo.S1);
    // One commit that takes s.txt straight to staging's version: its patch matches no
    // single staging commit (S2 and S3 each add one line), so only the content test can
    // accept it.
    commit(repo.work, 's.txt', 'A\nB\nC\n', 'align s.txt with staging');
    const r = check(repo, head(repo));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/align s\.txt with staging/);
    expect(r.out).toMatch(/matches 'staging'/);
  });

  test("an integration commit that leaves a file different from staging's fails", () => {
    const repo = makeRepo();
    prBranch(repo, 'feature-abz-main');
    git(repo.work, 'cherry-pick', '-x', repo.S1);
    commit(repo.work, 's.txt', 'A\nB\nZ\n', 'main-only tweak to s.txt');
    const r = check(repo, head(repo));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/main-only tweak to s\.txt/);
  });

  test('a ref that cannot be resolved is a CI problem (exit 2), never a pass', () => {
    const repo = makeRepo();
    const r = check(repo, '0123456789abcdef0123456789abcdef01234567');
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/could not resolve/);
  });
});
