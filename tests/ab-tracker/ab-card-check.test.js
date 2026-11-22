/**
 * ab-card-check: a pull request that adds an A/B launch signal must carry a registry entry, and arms are chosen
 * only through the shared ab-assign module. Fixture diffs in, problems out; no git, no network.
 */
const path = require('path');
const { check, parseDiff } = require(path.resolve(__dirname, '..', '..', 'scripts', 'ab-card-check.js'));

const HASH = 'a'.repeat(64);
const ENTRY = { test_id: 'lp-hook-length', flag_key: 'ab_lp_hook_enabled', card_sha256: HASH };
const REG = { tests: [ENTRY] };

function diff(file, added = [], removed = []) {
  return [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, '@@ -1 +1 @@',
    ...removed.map((l) => '-' + l), ...added.map((l) => '+' + l)].join('\n') + '\n';
}
const run = (d, registry = { tests: [] }) => check({ diff: d, registry });

describe('ab-card-check', () => {
  test('a new ab_ flag key with no registry entry fails', () => {
    const r = run(diff('src/lp.js', ["const on = await setting('ab_lp_hook_enabled');"]));
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/ab_lp_hook_enabled/);
  });

  test('the same key with its registry entry passes', () => {
    expect(run(diff('src/lp.js', ["const on = await setting('ab_lp_hook_enabled');"]), REG).ok).toBe(true);
  });

  test('an ab_ key that is not the registered flag_key fails', () => {
    expect(run(diff('src/lp.js', ["setting('ab_other_enabled')"]), REG).ok).toBe(false);
  });

  test('choosing an arm outside the shared module fails, even with a registry entry', () => {
    const r = run(diff('src/lp.js', ['const arm = armFor(user);']), REG);
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/shared ab-assign module/);
  });

  test('hash % n arm picking fails', () => {
    expect(run(diff('src/lp.py', ['arm = hash(uid) % 2']), REG).ok).toBe(false);
  });

  test('getGroup counts only beside A/B context', () => {
    expect(run(diff('src/a.js', ['const g = getGroup(rows);'])).ok).toBe(true);
    expect(run(diff('src/a.js', ['const g = getGroup(cohort);'])).ok).toBe(false);
  });

  test('a storage bucket() call is not an arm pick', () => {
    expect(run(diff('src/r2.js', ['await r2.get(key, { bucket: bucket() });'])).ok).toBe(true);
  });

  test('assignArm through the shared module passes with a valid entry, fails with none', () => {
    const d = diff('src/lp.js', ["const a = await assignArm('lp-hook-length', user.id);"]);
    expect(run(d, REG).ok).toBe(true);
    expect(run(d).ok).toBe(false);
  });

  test('an insert into an assignment table needs a registry entry', () => {
    const d = diff('db/m.sql', ["INSERT INTO lp_ab_assignment (user_id, arm) VALUES ($1, $2);"]);
    expect(run(d).ok).toBe(false);
    expect(run(d, REG).ok).toBe(true);
  });

  test('an ordinary app_settings insert passes; one carrying an ab_ key does not', () => {
    expect(run(diff('db/m.sql', ["INSERT INTO app_settings (key, value) VALUES ('child_test_enabled', 'true');"])).ok).toBe(true);
    expect(run(diff('db/m.sql', ["INSERT INTO app_settings (key, value) VALUES ('ab_x_enabled', 'true');"])).ok).toBe(false);
  });

  test('legacy keys pass', () => {
    expect(run(diff('src/lp.js', ["setting('ab_lp_ch310_enabled')", "setting('topic_end_nudge_enabled')"])).ok).toBe(true);
  });

  test('the live video-clip test keeps its own switch; any other *_AB_ENABLED still needs an entry', () => {
    expect(run(diff('bot/x/flags.js', ['env.VIDEO_RECO_AB_ENABLED === "true"'])).ok).toBe(true);
    expect(run(diff('bot/x/flags.js', ['env.QUIZ_AB_ENABLED === "true"'])).ok).toBe(false);
  });

  test('test files, the shared module and the registry itself are skipped', () => {
    expect(run(diff('tests/x/lp.test.js', ['armFor(user)'])).ok).toBe(true);
    expect(run(diff('shared/services/ab-assign.service.js', ['bucketOf(x); armFor(u)'])).ok).toBe(true);
    expect(run(diff('bot/shared/services/ab-assign.service.js', ['armFor(u)'])).ok).toBe(true);
  });

  test('a removed or moved signal passes', () => {
    expect(run(diff('src/lp.js', [], ["setting('ab_x_enabled')"])).ok).toBe(true);
    expect(run(diff('src/lp.js', ["  setting('ab_x_enabled') "], ["setting('ab_x_enabled')"])).ok).toBe(true);
  });

  test('comments and SQL reads are not launches', () => {
    expect(run(diff('src/lp.js', ['// armFor(user) used to live here', ' * armFor(user) in a doc block'])).ok).toBe(true);
    expect(run(diff('q.sql', ["SELECT * FROM app_settings WHERE key = 'ab_x_enabled';"])).ok).toBe(true);
    expect(run(diff('src/a.js', ["fetch('https://x.io'); armFor(u);"])).ok).toBe(false);
  });

  test('non-code files are skipped', () => {
    expect(run(diff('docs/plan.md', ['armFor(user) and ab_x_enabled'])).ok).toBe(true);
  });

  test.each([
    ['a bad hash', { ...ENTRY, card_sha256: 'abc' }, /card_sha256/],
    ['a flag key without ab_', { ...ENTRY, flag_key: 'lp_hook_enabled' }, /flag_key/],
    ['a bead id for a test_id', { ...ENTRY, test_id: 'bd-x1y2z.4' }, /test_id/],
    ['a bead id anywhere', { ...ENTRY, test_id: 'lp-bd-abc12' }, /test_id/],
  ])('a registry entry with %s fails', (_n, entry, re) => {
    const r = run('', { tests: [entry] });
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(re);
  });

  test('a malformed entry does not satisfy a launch', () => {
    const d = diff('src/lp.js', ["setting('ab_lp_hook_enabled')"]);
    expect(run(d, { tests: [{ ...ENTRY, card_sha256: 'x' }] }).ok).toBe(false);
  });

  test('a registry that is not {tests: []} fails', () => {
    expect(run('', { tests: 'nope' }).ok).toBe(false);
  });

  test('parseDiff groups added and removed lines by file', () => {
    const files = parseDiff(diff('a.js', ['x'], ['y']) + diff('b.js', ['z']));
    expect(files).toEqual([{ file: 'a.js', added: 'x', removed: 'y' }, { file: 'b.js', added: 'z', removed: '' }]);
  });
});
