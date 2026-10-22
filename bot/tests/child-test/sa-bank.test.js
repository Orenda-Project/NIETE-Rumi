'use strict';

/**
 * The self-administered (SA) battery bank (CONTRACT §2): item-bank.sa.v1.json and sa/<form>.json are generated from
 * item-bank.v3.json by shared/services/child-test/sa/build.js and never edited by hand. These checks hold the sourcing
 * rule (every scored item and every tap option comes from the official bank), the modes and stop rules of DESIGN §2,
 * the forms of DESIGN §3/§4, and the child-facing copy rules (en + ur on every line, Urdu letters not Arabic
 * look-alikes, no gendered verb aimed at the child).
 */

const path = require('path');
const fs = require('fs');

const DATA = path.join(__dirname, '../../shared/data/child-test');
const { buildSaBank, splitSaBankWithRuntime } = require('../../shared/services/child-test/sa/build');
const v3 = require('../../shared/data/child-test/item-bank.v3.json');
const extra = require('../../shared/data/child-test/item-bank.sa-extra.v1.json');
const w3 = require('../../shared/data/child-test/item-bank.sa-w3.v1.json');

const read = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));
const bank = read('item-bank.sa.v1.json');
// The W3 forms' tasks have their own shape and guards (sa-rdf-w3.test.js).
const tasks = Object.entries(bank.tasks).filter(([, t]) => !t.w3);

const ARABIC_LOOKALIKES = /[يكهى]/u;
const GENDERED_TO_CHILD = /(گا\/گی|گے\/گی|تا\/تی|تے\/تی|سکتے ہیں|سکتی ہیں)/u;

/** Resolve "v3:sets.A.reading.ur.letters.items[3]" to the value it names. */
function resolveSrc(ref) {
  const m = /^v3:(.+)$/.exec(ref);
  if (!m) return undefined;
  return m[1].split('.').reduce((o, part) => {
    if (o === undefined) return undefined;
    const pm = /^([^[]+)((?:\[\d+\])*)$/.exec(part);
    let cur = o[pm[1]];
    for (const ix of (pm[2].match(/\d+/g) || [])) cur = cur === undefined ? undefined : cur[Number(ix)];
    return cur;
  }, v3);
}

function strings(x, out = [], key = '') {
  if (typeof x === 'string') out.push([key, x]);
  else if (Array.isArray(x)) x.forEach((v, i) => strings(v, out, `${key}[${i}]`));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) strings(v, out, `${key}.${k}`);
  return out;
}

const scoredItems = (t) => [...((t.tap && t.tap.items) || []), ...((t.record && t.record.questions) || []),
  ...((t.record && t.record.passage && t.record.passage.words) || [])];

describe('SA battery bank (CONTRACT §2)', () => {
  test('the committed files are exactly what the builder makes (no hand edits)', () => {
    const files = JSON.parse(JSON.stringify(splitSaBankWithRuntime(buildSaBank({ v3, extra, w3 }))));
    for (const [rel, want] of Object.entries(files)) expect([rel, read(rel)]).toEqual([rel, want]);
    expect(fs.readdirSync(path.join(DATA, 'sa')).sort()).toEqual(Object.keys(files).filter((f) => f.startsWith('sa/')).map((f) => f.slice(3)).sort());
  });

  test('forms: coach G3/G5 with the five blocks and the full order; game G1-G5 by band with islands and the tower', () => {
    expect(Object.keys(bank.forms).sort()).toEqual(['coach.G1.A', 'coach.G2.A', 'coach.G3.A', 'coach.G4.A', 'coach.G5.A', 'game.G1', 'game.G23', 'game.G45']);
    const gameGrades = Object.values(bank.forms).filter((f) => f.surface === 'game').flatMap((f) => f.grades).sort();
    expect(gameGrades).toEqual([1, 2, 3, 4, 5]);
    for (const [id, f] of Object.entries(bank.forms)) {
      for (const t of f.order) expect(bank.tasks[`${id}/${t}`]).toBeDefined();
      if (f.surface === 'coach') {
        expect(Object.keys(f.blocks)).toEqual(['B1', 'B2', 'B3', 'B4', 'B5']);
        // Every core task is in exactly one block; an extra task (DESIGN §2b) is in the full form, and none joins a block (RULING #16).
        const inBlocks = Object.values(f.blocks).flat();
        expect(new Set(inBlocks).size).toBe(inBlocks.length);
        expect(f.full.filter((t) => !inBlocks.includes(t)).sort()).toEqual([...f.extra].sort());
      } else {
        expect(Object.keys(f.islands).sort()).toEqual(['english', 'maths', 'urdu']);
        // The islands run every task of the form, the second passage and story in place of Set A's (sa-reading-2).
        const swapped = f.extra.filter((t) => /(story|listening)2(_comp)?$/.test(t)).map((t) => t.replace('2', ''));
        expect(Object.values(f.islands).flat().sort()).toEqual([...f.tower.filter((t) => !swapped.includes(t)), ...f.extra].sort());
      }
    }
  });

  test.each(tasks)('%s carries the CONTRACT §2 fields', (_, t) => {
    for (const k of ['task', 'lang', 'kind', 'legacy_block', 'title', 'modes', 'tap', 'record', 'practice', 'script', 'source', 'deviation']) {
      expect(t).toHaveProperty(k);
    }
    if (t.legacy_block === null) expect(t.source.items).toMatch(/^(extra:(maths|reading)|v3:sets\.A\.reading)\./);
    else expect(t.legacy_block).toMatch(/^(ur|en|ma)\.(listening|letters|nonwords|words|story|number_id|discrimination|missing|add1|sub1|add2|sub2|word_problems)$/);
    for (const m of t.modes) expect(t[m]).toBeTruthy();
    if (!t.practice.length) expect(t.practice_note).toBeTruthy();
    for (const k of ['intro', 'begin', 'replay', 'time_up', 'early_stop', 'after', 'hand_back', 'practice_right', 'practice_wrong']) {
      expect(t.script[k].en && t.script[k].ur && t.script[k].audio.en && t.script[k].audio.ur).toBeTruthy();
    }
    expect(t.source.items && t.source.sa_adaptation).toBeTruthy();
  });

  test('every scored item cites its v3 path, and that path holds it', () => {
    for (const [, t] of tasks) {
      for (const it of scoredItems(t)) {
        if (/^extra:/.test(it.src)) continue; // extra items resolve against item-bank.sa-extra.v1.json (sa-extra.test.js)
        const at = resolveSrc(it.src);
        expect([it.src, at === undefined]).toEqual([it.src, false]);
        if (t.tap && t.tap.items.includes(it)) {
          const want = at !== null && typeof at === 'object' ? at.answer : at;
          expect([it.id, String(it.target)]).toEqual([it.id, String(want)]);
        }
      }
    }
  });

  test('tap options: letters 5, others 4 (the pair for comparison); the target once; list tasks draw only from their own list', () => {
    for (const [, t] of tasks) {
      if (!t.tap || t.tap.input !== 'options') continue;
      const list = t.record && t.record.grid ? t.record.grid.map(String) : null;
      for (const it of [...t.tap.items, ...t.practice]) {
        expect(it.options).toHaveLength(t.tap.options_n);
        expect(it.options.filter((o) => String(o) === String(it.target))).toHaveLength(1);
        expect(new Set(it.options.map(String)).size).toBe(it.options.length);
        if (list && !String(it.id).includes('.p')) for (const o of it.options) expect(list).toContain(String(o));
      }
      expect(t.tap.options_n).toBe(/letter(s|_sounds)$/.test(t.task) ? 5 : t.task === 'ma.discrimination' ? 2 : 4);
    }
  });

  test('modes and stop rules are DESIGN §2\'s', () => {
    for (const [, t] of tasks) {
      const kind = t.task.split('.')[1];
      if (['letters', 'nonwords', 'words'].includes(kind)) {
        expect(t.modes).toEqual(['tap']);
        expect(t.tap.stop).toEqual({ type: 'first_row', n: kind === 'letters' ? 10 : 5, max_correct: kind === 'letters' ? 2 : 1 }); // at chance (RULING #17)
        expect([t.tap.time_limit_s, t.tap.item_timeout_s, t.tap.replay_at_s]).toEqual([60, 10, 5]);
      }
      if (kind === 'story') {
        expect(t.modes).toEqual(['record']);
        expect(t.record.last_word_tap).toBe(true);
        expect(t.record.stop.type).toBe('first_line');
        expect(t.record.stop.n).toBe(t.record.passage.words.filter((w) => w.line === 1).length);
      }
      if (['story_comp', 'listening'].includes(kind)) expect(t.modes).toEqual(['record']);
      if (kind === 'story_comp') expect(t.depends_on.task).toBe(`${t.lang}.story`);
      if (['add1', 'sub1', 'add2', 'sub2', 'word_problems'].includes(kind)) expect(t.tap.input).toBe('keypad');
      if (['discrimination', 'missing', 'add2', 'sub2', 'word_problems'].includes(kind)) expect(t.tap.stop).toEqual({ type: 'consecutive_errors', n: 4 });
      if (['add2', 'sub2'].includes(kind)) expect(t.depends_on).toEqual({ task: `ma.${kind.slice(0, 3)}1`, skip_if_zero: true });
    }
  });

  test('child-facing copy: both languages on every line, Urdu letters, nothing gendered aimed at the child', () => {
    for (const [key, s] of strings(bank)) {
      if (/\.ur$/.test(key) || /\.say\.text$/.test(key)) {
        expect([key, ARABIC_LOOKALIKES.test(s)]).toEqual([key, false]);
        expect([key, GENDERED_TO_CHILD.test(s)]).toEqual([key, false]);
      }
    }
    for (const line of Object.values(bank.lines)) expect(line.en && line.ur).toBeTruthy();
  });
});
