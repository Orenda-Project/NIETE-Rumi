'use strict';

/**
 * The self-administered (SA) battery bank: item-bank.sa.v1.json is generated from the v3/v4 banks by
 * shared/services/child-test/sa/build.js and never edited by hand. These checks hold the sourcing rule (every
 * scored item and every tap choice comes from an official bank), the battery shape the SA engine validates, and the
 * child-facing copy rules (en + ur on every line, Urdu letters not Arabic look-alikes, no slashed gender forms).
 */

const path = require('path');
const fs = require('fs');

const DATA = path.join(__dirname, '../../shared/data/child-test');
const { buildSaBank, splitSaBank } = require('../../shared/services/child-test/sa/build');
const v3 = require('../../shared/data/child-test/item-bank.v3.json');
const v4 = require('../../shared/data/child-test/item-bank.v4.json');

const read = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));
const index = read('item-bank.sa.v1.json');
const batteries = index.batteries.map((row) => read(row.file));
const tasks = batteries.flatMap((b) => b.tasks.map((t) => [b, t]));

const KINDS = ['grid', 'choice', 'passage', 'listen_choice', 'record_only'];
const MODES = ['tap', 'record', 'both'];
const ARABIC_LOOKALIKES = /[يكهى]/u;
const SLASHED_GENDER = /(گا\/گی|گے\/گی|تا\/تی|تے\/تی|ا\/ی )/u;

/** Resolve "v3:sets.A.reading.ur.letters.items[3]" (or v4:…) to the value it names. */
function resolveSrc(ref) {
  const m = /^(v3|v4):(.+)$/.exec(ref);
  if (!m) return undefined;
  const root = m[1] === 'v3' ? v3 : v4;
  return m[2].split(/\.(?![^[]*\])/).reduce((o, part) => {
    if (o === undefined) return undefined;
    const pm = /^([^[]+)((?:\[\d+\])*)$/.exec(part);
    let cur = o[pm[1]];
    for (const ix of (pm[2].match(/\d+/g) || [])) cur = cur === undefined ? undefined : cur[Number(ix)];
    return cur;
  }, root);
}

function strings(x, out = [], key = '') {
  if (typeof x === 'string') out.push([key, x]);
  else if (Array.isArray(x)) x.forEach((v, i) => strings(v, out, `${key}[${i}]`));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) strings(v, out, `${key}.${k}`);
  return out;
}

describe('SA battery bank (item-bank.sa.v1.json)', () => {
  test('is exactly what the builder makes from the v3/v4 banks (no hand edits)', () => {
    const files = JSON.parse(JSON.stringify(splitSaBank(buildSaBank({ v3, v4 }))));
    expect(Object.keys(files).sort()).toEqual(['item-bank.sa.v1.json', ...index.batteries.map((b) => b.file)].sort());
    for (const [rel, want] of Object.entries(files)) expect([rel, read(rel)]).toEqual([rel, want]);
  });

  test('has the coach forms (Grade 3 and 5, the term set) and the game forms (Grades 1-5 by Challenge band)', () => {
    const forms = new Set(batteries.map((b) => b.form));
    for (const f of ['coach.G3.A', 'coach.G5.A', 'game.G1', 'game.G23', 'game.G45']) expect(forms).toContain(f);
    for (const b of batteries) expect(['ur', 'en']).toContain(b.lang);
    expect(batteries.filter((b) => b.surface === 'game').flatMap((b) => b.grades).sort()).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  test('every battery covers English, Urdu and maths, and its task ids are unique', () => {
    for (const b of batteries) {
      const ids = b.tasks.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const fam of ['ur.', 'en.', 'ma.']) expect(ids.some((id) => id.startsWith(fam))).toBe(true);
    }
  });

  test.each(tasks.map(([b, t]) => [`${b.battery_id} ${t.id}`, t]))('%s has the engine shape', (_, t) => {
    expect(KINDS).toContain(t.kind);
    expect(MODES).toContain(t.mode);
    expect(['egra', 'egma']).toContain(t.family);
    expect(t.timed_s === null || t.timed_s === 60).toBe(true);
    expect(t.stop && typeof t.stop).toBe('object');
    expect(t.scoring && typeof t.scoring.unit).toBe('string');
    expect(t.instruction.text.en && t.instruction.text.ur).toBeTruthy();
    expect(Array.isArray(t.practice)).toBe(true);
    if (!t.practice.length) expect(t.practice_note).toBeTruthy();
    expect(t.source && t.source.items).toBeTruthy();
    expect(t.items.length).toBeGreaterThan(0);
  });

  test('every scored item cites its bank path, and that path holds the item', () => {
    for (const [, t] of tasks) {
      for (const it of t.items) {
        expect(it.src).toMatch(/^(v3|v4):/);
        const at = resolveSrc(it.src);
        expect(at).toBeDefined();
        const want = typeof at === 'object' && at !== null ? (at.answer ?? at.n ?? at.item) : at;
        if (it.answer !== undefined && t.kind !== 'listen_choice' && t.id.indexOf('comp') < 0) expect(String(want)).toBe(String(it.answer));
      }
    }
  });

  test('tap choices hold the answer once, are distinct, and come from the same official pool', () => {
    for (const [, t] of tasks) {
      for (const it of [...t.items, ...t.practice]) {
        if (!it.choices) continue;
        expect(it.choices.filter((c) => String(c) === String(it.answer))).toHaveLength(1);
        expect(new Set(it.choices.map(String)).size).toBe(it.choices.length);
        expect(it.choices.length).toBeGreaterThanOrEqual(2);
        if (t.distractor_pool) for (const c of it.choices) expect(t.distractor_pool.map(String)).toContain(String(c));
      }
    }
  });

  test('stop rules are the EGRA/EGMA ones', () => {
    for (const [, t] of tasks) {
      if (t.kind === 'grid' && t.family === 'egra') expect(t.stop.first_line_n).toBeGreaterThan(0);
      if (t.kind === 'passage') expect(t.stop.first_line_min_correct).toBe(1);
      if (t.timed_s) expect(t.stop.time_up).toBe(true);
    }
  });

  test('child-facing copy: Urdu letters, no slashed gender forms, both languages on every line', () => {
    for (const b of batteries) {
      for (const [key, s] of strings(b)) {
        if (/\.ur$/.test(key)) {
          expect([key, ARABIC_LOOKALIKES.test(s)]).toEqual([key, false]);
          expect([key, SLASHED_GENDER.test(s)]).toEqual([key, false]);
        }
      }
      for (const t of b.tasks) {
        for (const line of Object.values(t.script || {})) expect(line.en && line.ur).toBeTruthy();
      }
    }
  });
});
