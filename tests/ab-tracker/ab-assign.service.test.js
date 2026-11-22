// ab-assign.service: the one hash split for A/B arms, and the launch gate (a bare flag serves control only).
// Pinned to the workspace's assign.py by fixtures/assign_vectors.json (20 ids).
const fs = require('fs');
const os = require('os');
const path = require('path');
const ab = require('../../bot/shared/services/ab-assign.service');

const VEC = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'assign_vectors.json'), 'utf8'));
const SHA = 'a'.repeat(64);
const TEST = { flagKey: 'ab_lp_short_enabled', salt: VEC.salt, sharesBp: VEC.shares_bp, controlArm: 'A' };
const ENTRY = { test_id: 'ict-lp-short-vs-full', flag_key: 'ab_lp_short_enabled', card_sha256: SHA };
const unitIn = (arm) => VEC.cases.find((c) => c.arm === arm).unit_id;

function repoWith(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-reg-'));
  if (contents !== undefined) {
    fs.mkdirSync(path.join(dir, 'ab'));
    fs.writeFileSync(path.join(dir, 'ab', 'registry.json'), contents);
  }
  return dir;
}

function logger() {
  const lines = [];
  return { lines, log: (m) => lines.push(m) };
}

describe('ab-assign hash split', () => {
  test('20 shared vectors: bucket and arm match the Python split', () => {
    expect(VEC.cases).toHaveLength(20);
    for (const c of VEC.cases) {
      expect(ab.bucket(VEC.salt, c.unit_id)).toBe(c.bucket);
      expect(ab.armFor(VEC.salt, c.unit_id, VEC.shares_bp)).toBe(c.arm);
      expect(ab.armFor(VEC.salt, c.unit_id, VEC.shares_bp_3)).toBe(c.arm_3);
    }
  });

  test('shares that do not add up to 10000 throw', () => {
    expect(() => ab.armFor('s', 'u', { A: 5000, B: 4000 })).toThrow();
  });
});

describe('ab-assign launch gate: a bare flag does nothing', () => {
  test('flag on with no registry entry serves control and logs one line', () => {
    const { lines, log } = logger();
    const repo = repoWith(JSON.stringify({ tests: [] }));
    for (const c of VEC.cases) expect(ab.assignArm({ ...TEST, unitId: c.unit_id }, { repoRoot: repo, log })).toBe('A');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/ab_lp_short_enabled/);
  });

  test('no registry file serves control', () => {
    const { log } = logger();
    expect(ab.assignArm({ ...TEST, unitId: unitIn('B') }, { repoRoot: repoWith(), log })).toBe('A');
  });

  test('a registry entry with a frozen card hash serves the hashed arms', () => {
    const { lines, log } = logger();
    const repo = repoWith(JSON.stringify({ tests: [ENTRY] }));
    for (const c of VEC.cases) expect(ab.assignArm({ ...TEST, unitId: c.unit_id }, { repoRoot: repo, log })).toBe(c.arm);
    expect(lines).toHaveLength(0);
  });

  test.each([
    ['not JSON', '{not json'],
    ['a short hash', JSON.stringify({ tests: [{ ...ENTRY, card_sha256: 'short' }] })],
    ['no hash', JSON.stringify({ tests: [{ test_id: 'x', flag_key: 'ab_lp_short_enabled' }] })],
    ['no tests list', '42'],
  ])('a malformed registry (%s) serves control', (_, bad) => {
    const { lines, log } = logger();
    expect(ab.assignArm({ ...TEST, unitId: unitIn('B') }, { repoRoot: repoWith(bad), log })).toBe('A');
    expect(lines).toHaveLength(1);
  });

  test('an entry for another test id does not open this salt', () => {
    const { log } = logger();
    const repo = repoWith(JSON.stringify({ tests: [{ ...ENTRY, test_id: 'other-test' }] }));
    expect(ab.assignArm({ ...TEST, unitId: unitIn('B') }, { repoRoot: repo, log })).toBe('A');
  });

  test('a flag key that does not start ab_ serves control, even with an entry', () => {
    const { lines, log } = logger();
    const repo = repoWith(JSON.stringify({ tests: [{ ...ENTRY, flag_key: 'lp_short_enabled' }] }));
    const t = { ...TEST, flagKey: 'lp_short_enabled', unitId: unitIn('B') };
    expect(ab.assignArm(t, { repoRoot: repo, log })).toBe('A');
    expect(lines[0]).toMatch(/ab_/);
  });

  test('the registry is read once and cached: a later edit to the file changes nothing until restart', () => {
    const { log } = logger();
    const repo = repoWith(JSON.stringify({ tests: [ENTRY] }));
    const t = { ...TEST, unitId: unitIn('B') };
    expect(ab.assignArm(t, { repoRoot: repo, log })).toBe('B');
    fs.writeFileSync(path.join(repo, 'ab', 'registry.json'), JSON.stringify({ tests: [] }));
    expect(ab.assignArm(t, { repoRoot: repo, log })).toBe('B');
  });

  test("this repo's own ab/registry.json parses and registers no test yet, so every flag serves control", () => {
    const { lines, log } = logger();
    expect(ab.assignArm({ ...TEST, unitId: unitIn('B') }, { log })).toBe('A');
    expect(lines[0]).toMatch(/no registry entry/);
  });
});
