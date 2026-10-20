'use strict';

/**
 * The SA reading extras (DESIGN §2b) and the tap-option rules every reading task shares: exactly one right tile per
 * prompt (S and s share a name; c and k share a sound; س and ص share a sound), distractors that do not give the
 * answer away by length, and practice items from an official form where v3 holds none.
 */

const path = require('path');
const fs = require('fs');

const DATA = path.join(__dirname, '../../shared/data/child-test');
const extra = require('../../shared/data/child-test/item-bank.sa-extra.v1.json');
const { UR_LETTER_NAMES } = require('../../shared/services/child-test/sa/scripts');

const bank = JSON.parse(fs.readFileSync(path.join(DATA, 'item-bank.sa.v1.json'), 'utf8'));
const tasksOf = (name) => Object.entries(bank.tasks).filter(([k]) => k.endsWith(`/${name}`)).map(([, t]) => t);
const MARKS = /[ً-ٰٟ]/gu;
const len = (x) => [...String(x).replace(MARKS, '')].length;
const UR_GROUPS = [['ذ', 'ز', 'ض', 'ظ'], ['ث', 'س', 'ص'], ['ت', 'ط'], ['ح', 'ہ', 'ھ'], ['ع', 'ا', 'آ', 'ء'], ['ک', 'ق']];
const urSound = (x) => (UR_GROUPS.find((g) => g.includes(x)) || [x])[0];
const enSound = (x) => ({ c: 'k', q: 'k' }[String(x).toLowerCase()] || String(x).toLowerCase());

/** "extra:reading.en.initial_sound.items[3]" → that entry of item-bank.sa-extra.v1.json. */
function resolve(ref) {
  const m = /^extra:(.+)$/.exec(ref);
  return m[1].split('.').reduce((o, part) => {
    const pm = /^([^[]+)((?:\[\d+\])*)$/.exec(part);
    let cur = o && o[pm[1]];
    for (const ix of (pm[2].match(/\d+/g) || [])) cur = cur === undefined ? undefined : cur[Number(ix)];
    return cur;
  }, extra);
}

function oneRightTile(t, key) {
  for (const it of [...t.tap.items, ...t.practice]) {
    const keys = it.options.map(key);
    expect([it.id, new Set(keys).size]).toEqual([it.id, it.options.length]);
    expect(it.options).toContain(it.target);
  }
}

describe('SA reading: one right tile per prompt', () => {
  test('letters: never the same letter name twice on screen (S and s; two Urdu letters with one name)', () => {
    for (const t of tasksOf('en.letters')) oneRightTile(t, (x) => String(x).toLowerCase());
    for (const t of tasksOf('ur.letters')) oneRightTile(t, (x) => UR_LETTER_NAMES[x] || x);
  });

  test('sound prompts: never two letters with the same sound on screen', () => {
    for (const t of [...tasksOf('en.letter_sounds'), ...tasksOf('en.initial_sound')]) oneRightTile(t, enSound);
    for (const t of tasksOf('ur.initial_sound')) oneRightTile(t, urSound);
  });

  test('words and made-up words: length gives nothing away (same-length list-mates first)', () => {
    for (const name of ['ur.nonwords', 'en.nonwords', 'ur.words', 'en.words']) {
      const t = tasksOf(name)[0];
      const list = t.record.grid.map(String);
      for (const it of t.tap.items) {
        const mates = new Set(list.filter((x) => x !== String(it.target) && len(x) === len(it.target))).size;
        const same = it.options.filter((o) => o !== it.target && len(o) === len(it.target)).length;
        expect([it.id, same]).toEqual([it.id, Math.min(3, mates)]);
      }
    }
  });
});

describe('SA reading extras (DESIGN §2b)', () => {
  test('ur.letters and ur.words practise first, with the official PRP-KP practice items', () => {
    for (const name of ['ur.letters', 'ur.words']) {
      for (const t of tasksOf(name)) {
        expect(t.practice.map((p) => p.role)).toEqual(['example', 'practice', 'practice']);
        for (const p of t.practice) {
          expect(p.src).toMatch(/^extra:reading\.ur\.(letters|words)_practice\[\d\]$/);
          expect(resolve(p.src).item).toBe(p.target);
          expect(p.feedback.correct.ur && p.feedback.wrong.ur).toBeTruthy();
        }
      }
    }
  });

  test('en.letter_sounds: the TK2009 grid, 5 tiles, a sound for Jugnu to say, 60 s, first-row stop', () => {
    const t = tasksOf('en.letter_sounds')[0];
    expect(t.tap.items.map((i) => i.target)).toEqual(extra.reading.en.letter_sounds.items.map((x) => x.letter));
    expect(t.tap.items.every((i) => i.options.length === 5 && i.say_kind === 'sound' && i.say.lang === 'en')).toBe(true);
    expect([t.tap.time_limit_s, t.tap.stop]).toEqual([60, { type: 'first_row', n: 10, max_correct: 2 }]);
    expect(t.practice.map((p) => p.target)).toEqual(['M', 'S']);
  });

  test('initial sound: Jugnu says the word twice, the target is its first letter, options are the list\'s first letters', () => {
    for (const lang of ['en', 'ur']) {
      const t = tasksOf(`${lang}.initial_sound`)[0];
      const src = extra.reading[lang].initial_sound.items;
      const firsts = src.map((w) => (lang === 'en' ? w.word[0] : w.letter));
      t.tap.items.forEach((it, i) => {
        expect(resolve(it.src)).toBe(src[i]);
        expect(it.target).toBe(firsts[i]);
        for (const o of it.options) expect(firsts).toContain(o);
        expect(it.say.text.split(lang === 'en' ? '.' : '۔').filter((x) => x.trim()).map((x) => x.trim())).toEqual([src[i].word, src[i].word]);
      });
      expect(t.tap.stop).toEqual({ type: 'first_row', n: 5 });
      expect(t.practice.length).toBe(2);
    }
  });

  test('placement: extras in the full form, not the blocks (RULING #16); extras on their islands; the tower stays the core battery', () => {
    const c = bank.forms['coach.G5.A'];
    expect(c.blocks.B3).toEqual(['ur.listening', 'en.listening']);
    expect(c.full.indexOf('en.letter_sounds')).toBe(c.full.indexOf('en.letters') + 1);
    const g = bank.forms['game.G1'];
    expect(g.islands.english).toEqual(['en.listening2', 'en.initial_sound', 'en.segmentation', 'en.letters', 'en.letter_sounds', 'en.nonwords', 'en.words',
      'en.print_orientation', 'en.story2', 'en.story2_comp', 'en.spelling']);
    expect(g.islands.urdu).toEqual(['ur.listening2', 'ur.vocabulary', 'ur.initial_sound', 'ur.letters', 'ur.nonwords', 'ur.words', 'ur.print_orientation', 'ur.story2', 'ur.story2_comp']);
    expect(g.tower).toHaveLength(20); // the 18 v3 blocks + the two story-question tasks
  });
});
