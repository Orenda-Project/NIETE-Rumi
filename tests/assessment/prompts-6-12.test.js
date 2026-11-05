'use strict';
/**
 * G6-12 prompt keys appended to ict-prompts.json, and the loader prompts-6-12.js (prompts contract §7).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const A = path.join(__dirname, '../../bot/shared/services/assessment');
const FILE = path.join(A, 'ict-prompts.json');
const PROMPTS = require('../../bot/shared/services/assessment/ict-prompts.json');
const P6 = require('../../bot/shared/services/assessment/prompts-6-12');
const BASE = require('./fixtures/ict-prompts.base.hashes.json').hashes;
const META = require('./fixtures/g612/prompt-keys.meta.json');
const REGISTRY = require('./fixtures/g612/subject-config.contract.json');
const PENDING = require('../../bot/shared/services/assessment/prompts-review-pending.json');

const OLD = Object.keys(BASE);
const NEW = Object.keys(META);
const SHARED = ['eg.format.secondary', 'eg.format.secondary_urdu', 'eg.safety.policies.6_12', 'eg.task.board_section'];
const SYSTEM = NEW.filter((k) => META[k].kind === 'system');
const core = REGISTRY.rows.filter((r) => r.status === 'core');
const MARKER = 'needs fluent-Urdu review';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const names = (text) => (text.match(/\{([a-z_]+)\}/g) || []).map((m) => m.slice(1, -1));
const fullValues = (key) => Object.fromEntries(META[key].placeholders.map((n) => [n, `<${n}>`]));
function thrown(fn) { try { fn(); } catch (e) { return e; } return null; }

describe('prompt-diff: the 13 old keys are untouched', () => {
  const lines = fs.readFileSync(FILE, 'utf8').split('\n');

  it('each old line hashes as before (trailing comma stripped), in the old order, lines 2-14', () => {
    OLD.forEach((key, i) => {
      const line = lines[i + 1].replace(/,$/, '');
      expect([key, line.startsWith(`  ${JSON.stringify(key)}: `), sha(line)]).toEqual([key, true, BASE[key]]);
    });
  });

  it('every old value parses unchanged and old keys come first', () => {
    expect(Object.keys(PROMPTS).slice(0, 13)).toEqual(OLD);
    expect(Object.keys(PROMPTS).slice(13)).toEqual(NEW);
  });

  it('one key per line, no duplicates, valid JSON', () => {
    const keyLines = lines.slice(1, -1);
    expect(keyLines).toHaveLength(OLD.length + NEW.length);
    const seen = keyLines.map((l) => Object.keys(JSON.parse(`{${l.replace(/,$/, '')}}`))[0]);
    expect(new Set(seen).size).toBe(seen.length);
    expect(lines[0]).toBe('{');
    expect(lines[lines.length - 1]).toBe('}');
  });
});

describe('the new keys', () => {
  it('cover every core registry row with its own key; 29 system keys + 4 shared', () => {
    for (const r of core) {
      expect(r.prompt_key).toBe(`eg.ict.${r.code}.${r.band}.system`);
      expect(typeof PROMPTS[r.prompt_key]).toBe('string');
      expect(PROMPTS[r.prompt_key].length).toBeGreaterThan(0);
    }
    expect(new Set(core.map((r) => r.prompt_key)).size).toBe(29);
    expect(SYSTEM).toHaveLength(29);
    for (const k of SHARED) expect(typeof PROMPTS[k]).toBe('string');
  });

  it('carry no G1-5 text and copy no old key', () => {
    for (const k of NEW) {
      expect(PROMPTS[k]).not.toMatch(/Grades \(1|Primary Grades|ages 6/);
      for (const o of OLD) expect(PROMPTS[k].includes(PROMPTS[o])).toBe(false);
    }
  });

  it('never ask for an image field', () => {
    for (const k of NEW) expect(PROMPTS[k]).not.toMatch(/"image"/);
    expect(PROMPTS['eg.format.secondary']).not.toMatch(/"[a-z_]*image[a-z_]*"\s*:/i);
  });

  it('placeholders in the text equal the contract list', () => {
    for (const k of NEW) expect([k, [...new Set(names(PROMPTS[k]))].sort()]).toEqual([k, [...META[k].placeholders].sort()]);
  });

  it('forbid the model writing official_slo, and show none in an example', () => {
    for (const k of [...SYSTEM, 'eg.format.secondary']) {
      expect(PROMPTS[k]).toMatch(/official_slo/);
      expect(PROMPTS[k]).not.toMatch(/"official_slo"\s*:\s*"/);
    }
  });

  it('name every tag field in each system text', () => {
    for (const k of SYSTEM) {
      for (const f of ['chapter', 'section', 'code', 'page', 'blooms', 'difficulty', 'kind']) {
        expect([k, f, PROMPTS[k].includes(f)]).toEqual([k, f, true]);
      }
    }
  });

  it('FBISE bands say "Summative SLOs only"; 6_8 does not', () => {
    for (const k of SYSTEM) {
      const fbise = META[k].band !== '6_8';
      expect([k, PROMPTS[k].includes('Summative SLOs only')]).toEqual([k, fbise]);
    }
  });

  it('list at least 20 names, the safety key the same ones', () => {
    const safety = PROMPTS['eg.safety.policies.6_12'];
    const list = (t) => (t.match(/\b[A-Z][a-z]+\b/g) || []);
    for (const k of SYSTEM) {
      const nm = list(PROMPTS[k]).filter((w) => safety.includes(w));
      expect([k, new Set(nm).size >= 20]).toEqual([k, true]);
    }
  });

  it('sidecar lists exactly the urdu_review keys; no prompt carries the marker', () => {
    const want = NEW.filter((k) => META[k].urdu_review).sort();
    expect(want).toHaveLength(10);
    expect(PENDING.keys.map((e) => e.key).sort()).toEqual(want);
    for (const e of PENDING.keys) expect(e).toEqual({ key: e.key, reason: MARKER, reviewed_by: null });
    expect(fs.readFileSync(FILE, 'utf8')).not.toContain(MARKER);
  });
});

describe('prompts-6-12.js', () => {
  it('promptFor returns the text; a missing key throws PROMPT_KEY_MISSING', () => {
    expect(P6.promptFor('eg.ict.physics.9_10.system')).toBe(PROMPTS['eg.ict.physics.9_10.system']);
    const e = thrown(() => P6.promptFor('eg.ict.nope.9_10.system'));
    expect(e.code).toBe('PROMPT_KEY_MISSING');
    expect(e.key).toBe('eg.ict.nope.9_10.system');
  });

  it('promptFor refuses a G1-5 key', () => {
    for (const k of OLD) expect(thrown(() => P6.promptFor(k)).code).toBe('PROMPT_KEY_MISSING');
  });

  it('fill replaces every listed name and leaves none', () => {
    for (const k of NEW) {
      const out = P6.fill(k, PROMPTS[k], fullValues(k));
      expect(out).not.toMatch(/\{[a-z_]+\}/);
      for (const n of META[k].placeholders) expect(out).toContain(`<${n}>`);
    }
  });

  it('fill keeps JSON braces and accepts 0 as a value', () => {
    expect(P6.fill('k', 'a {"x": 1} {n}', { n: 0 })).toBe('a {"x": 1} 0');
    expect(P6.fill('k', '{n} and {n}', { n: 'v' })).toBe('v and v');
  });

  it('fill throws PROMPT_PLACEHOLDER_UNFILLED naming the missing value', () => {
    for (const bad of [undefined, null]) {
      const e = thrown(() => P6.fill('k1', 'a {grade} b {age}', { grade: 9, age: bad }));
      expect([e.code, e.key, e.name]).toEqual(['PROMPT_PLACEHOLDER_UNFILLED', 'k1', 'age']);
    }
    expect(thrown(() => P6.fill('k1', 'x', null))).toBeNull();
  });

  const row = (code, grade) => core.find((r) => r.code === code && r.grade === grade);
  const valuesFor = (keys) => Object.assign({}, ...keys.map(fullValues));

  it('assemble (en, free): system, format, safety; safety last', () => {
    const r = row('physics', 9);
    const keys = [r.prompt_key, 'eg.format.secondary', 'eg.safety.policies.6_12'];
    const out = P6.assemble({ row: r, kind: 'free', values: valuesFor(keys) });
    expect(out).toBe(keys.map((k) => P6.fill(k, PROMPTS[k], valuesFor(keys))).join('\n\n'));
  });

  it('assemble (ur, board): system, format, urdu format, board task, safety', () => {
    const r = row('pakistan_studies_ur', 10);
    const keys = [r.prompt_key, 'eg.format.secondary', 'eg.format.secondary_urdu', 'eg.task.board_section',
      'eg.safety.policies.6_12'];
    const out = P6.assemble({ row: r, kind: 'board', values: valuesFor(keys) });
    expect(out).toBe(keys.map((k) => P6.fill(k, PROMPTS[k], valuesFor(keys))).join('\n\n'));
  });

  it('assemble refuses a row with no prompt key, and an unknown kind', () => {
    expect(thrown(() => P6.assemble({ row: { prompt_key: null }, values: {} })).code).toBe('PROMPT_KEY_MISSING');
    expect(thrown(() => P6.assemble({ row: row('maths', 6), kind: 'x', values: {} })).code).toBe('PROMPT_KIND_UNKNOWN');
  });

  it('levelValues renders scale, legend and split from the ToS levels', () => {
    expect(P6.levelValues({ levels: { R: 30, U: 30, A: 20, AE: 10, C: 10 }, tolerance_pp: 5 })).toEqual({
      level_scale: 'R/U/A/AE/C',
      level_legend: 'R Remember, U Understand, A Apply, AE Analyse/Evaluate, C Create',
      level_split: 'R 30 / U 30 / A 20 / AE 10 / C 10',
      tolerance_pp: 5,
    });
    expect(P6.levelValues({ levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 }).level_legend)
      .toBe('K Knowledge, U Understand, A Apply');
  });
});
