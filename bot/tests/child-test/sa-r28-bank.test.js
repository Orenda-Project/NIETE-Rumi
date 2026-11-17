'use strict';

/**
 * Round 28 content in the W3 coach forms (item-bank.sa-r28.v1.json → build-w3.js r28Tasks), each part behind its own
 * switch and stripped from the served battery while OFF:
 *   letter_pick10   the letter-sound picker: Jugnu says a sound, the child taps one of five letters (10 items, 2 practice)
 *   story_mcq_w3    every story question (and every rotation variant's) with four options and one target
 *   ext_items       the timed tasks continued past today's items, in the official grid order, then a named published
 *                   source, ending there; today's items, grid and stop unchanged (ext_stop: the extended run's stop)
 */

const path = require('path');
const fs = require('fs');

const DATA = path.join(__dirname, '../../shared/data/child-test');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));
const { buildSaBank, splitSaBankWithRuntime } = require('../../shared/services/child-test/sa/build');
const { applySwitches } = require('../../../dashboard/routes/sa-battery-switches');

const v3 = require('../../shared/data/child-test/item-bank.v3.json');
const extra = require('../../shared/data/child-test/item-bank.sa-extra.v1.json');
const w3 = require('../../shared/data/child-test/item-bank.sa-w3.v1.json');
const r28 = require('../../shared/data/child-test/item-bank.sa-r28.v1.json');

const COACH_FORMS = ['coach.G1.A', 'coach.G2.A', 'coach.G3.A', 'coach.G4.A', 'coach.G5.A'];
const TIMED = { 'ur.letter_names5': 5, 'en.letter_names5': 5, 'ur.words4': 4, 'en.words4': 4, 'ma.number_id8': 8, 'ma.fluency1m': 20 };
const runtime = (form, lang) => read(`sa/sa.${form}.${lang}.json`);
const byId = (b) => Object.fromEntries(b.tasks.map((t) => [t.id, t]));
const keysDeep = (x, out = new Set()) => {
  if (Array.isArray(x)) x.forEach((v) => keysDeep(v, out));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { out.add(k); keysDeep(v, out); }
  return out;
};

describe('round 28 bank (item-bank.sa-r28.v1.json)', () => {
  test('the committed batteries are what the builder makes from the four banks', () => {
    const files = splitSaBankWithRuntime(buildSaBank({ v3, extra, w3, r28 }));
    for (const form of COACH_FORMS) for (const lang of ['ur', 'en']) {
      expect(runtime(form, lang)).toEqual(JSON.parse(JSON.stringify(files[`sa/sa.${form}.${lang}.json`])));
    }
  });

  test('letter_pick10: 10 items × 5 different letters with the target once, 2 practice, tagged to replace letter_sounds5', () => {
    for (const form of COACH_FORMS) for (const lang of ['ur', 'en']) {
      const b = runtime(form, lang);
      for (const l of ['ur', 'en']) {
        const t = byId(b)[`${l}.letter_pick10`];
        expect(t).toBeDefined();
        expect(b.r28_tasks).toContain(t.id);
        expect(t).toMatchObject({ r28: 'letter_pick', replaces: `${l}.letter_sounds5`, kind: 'pick', response: 'tap',
          subtask: 'letter_sound_identification', w3: true, lang: l, replay_at_s: 10, next_at_s: 15, stop: {} });
        expect(t.time_limit_s).toBeUndefined();
        expect(t.items).toHaveLength(10);
        expect(t.practice).toHaveLength(2);
        expect(t.practice[0].role).toBe('example');
        t.items.forEach((it, i) => {
          expect(it.id).toBe(`${l}.letter_pick10.${String(i + 1).padStart(2, '0')}`);
          expect(new Set(it.options).size).toBe(5);
          expect(it.options.filter((o) => o === it.target)).toHaveLength(1);
          expect(it.prompt_audio).toMatch(new RegExp(`^sa/v5/${l}/[0-9a-f]{12}\\.mp3$`));
          expect(it.prompt_text).toBeTruthy();
          expect(it.src).toBeTruthy();
        });
        // each of the five card slots holds the answer exactly twice
        const slots = t.items.map((it) => it.options.indexOf(it.target));
        expect([0, 1, 2, 3, 4].map((k) => slots.filter((s) => s === k).length)).toEqual([2, 2, 2, 2, 2]);
      }
    }
  });

  test('story_mcq_w3: every question of the passage and of every variant has 4 options and one target, gates kept', () => {
    for (const form of COACH_FORMS) for (const lang of ['ur', 'en']) {
      const b = runtime(form, lang);
      for (const l of ['ur', 'en']) {
        const old = byId(b)[`${l}.story_comp_w3`];
        const t = byId(b)[`${l}.story_mcq_w3`];
        expect(t).toMatchObject({ r28: 'mcq', replaces: `${l}.story_comp_w3`, kind: 'mcq', response: 'tap',
          subtask: 'reading_comprehension', w3: true, depends_on: old.depends_on });
        const sets = [[t.items, old.items], ...(old.variants || []).map((v) => [t.variants.find((x) => x.id === v.id).items, v.items])];
        for (const [mine, theirs] of sets) {
          expect(mine.map((q) => q.id)).toEqual(theirs.map((q) => q.id));
          mine.forEach((q, i) => {
            expect(q.options).toHaveLength(4);
            expect(new Set(q.options).size).toBe(4);
            expect(q.option_audio).toHaveLength(4);
            expect(q.target_index).toBeGreaterThanOrEqual(0);
            expect(q.target_index).toBeLessThan(4);
            expect(q.needs_line).toEqual(theirs[i].needs_line);
            expect(q.gate).toEqual(theirs[i].gate);
          });
        }
        expect(t.practice).toHaveLength(1);
        expect(t.practice[0].options).toHaveLength(4);
      }
    }
  });

  test('options exist for every rotation passage\'s questions, and a typo fix names the live text it replaces', () => {
    const live = extra.reading.en.story2.questions.map((q) => q.q);
    expect(r28.mcq.questions['en.story2.q5']).toMatchObject({ question: 'What made the family happy again?', question_was: live[4] });
    for (let n = 1; n <= 5; n += 1) expect(r28.mcq.questions[`en.story2.q${n}`].options).toHaveLength(4);
    // the speculative q6 is replaced in the MCQ form by a literal question under a new id (an old id never gets new text)
    expect(r28.mcq.questions['en.story2.q6']).toBeUndefined();
    expect(r28.mcq.questions['en.story2.q6r']).toMatchObject({ replaces_question: 'en.story2.q6', question: "What did Mother put on Sam's leg?" });
    for (let n = 1; n <= extra.reading.ur.story2.questions.length; n += 1) expect(r28.mcq.questions[`ur.story2.q${n}`].options).toHaveLength(4);
  });

  test('ext_items: today\'s items, grid and stop unchanged, then the rest in order with new ids and a src each, no second pass', () => {
    for (const form of COACH_FORMS) for (const lang of ['ur', 'en']) {
      const b = runtime(form, lang);
      for (const [id, n] of Object.entries(TIMED)) {
        const t = byId(b)[id];
        expect([id, t.items.length, t.base_n]).toEqual([id, n, n]);
        if (t.grid) expect(t.grid).toHaveLength(n);
        expect(t.ext_items.length).toBeGreaterThan(n);
        const ids = [...t.items, ...t.ext_items].map((x) => x.id);
        expect(new Set(ids).size).toBe(ids.length);
        t.ext_items.forEach((x) => { expect(x.ext).toBe(true); expect(x.src).toBeTruthy(); });
        expect(t.ext_items[0].id).toBe(`${id}.${String(n + 1).padStart(2, '0')}`);
        expect(t.ext_items.some((x) => x.cycle || x.repeat_of)).toBe(false); // no second pass: the list ends
        expect(t.stop).toEqual({}); // today's stop; the first-row stop of an extended run is ext_stop, applied by the scorer
        if (/letter_names5$/.test(id)) expect(t.ext_stop).toEqual({ type: 'first_row', n: 10 });
        else if (/words4$/.test(id)) expect(t.ext_stop).toEqual({ type: 'first_row', n: 5 });
        else expect(t.ext_stop).toBeUndefined();
      }
    }
  });

  test('number identification: the Rwanda list only on the forms that hold Grades 4-5', () => {
    const rw = (form) => byId(runtime(form, 'ur'))['ma.number_id8'].ext_items.filter((x) => /P6/.test(x.src));
    expect(rw('coach.G3.A')).toHaveLength(0);
    expect(rw('coach.G5.A').length).toBeGreaterThan(0);
  });

  test('number identification: Core 20, then the Jordan 2021 page A grid in printed order, never a numeral twice in one run', () => {
    const jordanA = ['3', '9', '7', '0', '20', '77', '29', '61', '54', '58', '91', '70', '45', '89', '33', '104', '368', '740', '500', '898'];
    for (const form of COACH_FORMS) for (const lang of ['ur', 'en']) {
      const t = byId(runtime(form, lang))['ma.number_id8'];
      const shown = [...t.items, ...t.ext_items].map((x) => String(x.show));
      expect([form, lang, shown.filter((n, i) => shown.indexOf(n) !== i)]).toEqual([form, lang, []]);
      const jo = t.ext_items.filter((x) => /^jordan_egma_2021:stimulus p\.A/.test(x.src));
      const core = new Set(v3.sets.A.maths['3'].number_id.items);
      expect(jo.map((x) => String(x.show))).toEqual(jordanA.filter((n) => !core.has(n)));
      const grades45 = /G[45]\./.test(form);
      expect([form, shown.length]).toEqual([form, grades45 ? 50 : 42]);
    }
  });

  test('letter_pick10: b and m (ب and م) are never in one row (a pre-voiced /ba/ reads near /m/ on a phone speaker)', () => {
    for (const form of COACH_FORMS) for (const [l, pair] of [['en', ['b', 'm']], ['ur', ['ب', 'م']]]) {
      const t = byId(runtime(form, l))[`${l}.letter_pick10`];
      for (const it of [...t.items, ...t.practice]) expect([it.id, pair.every((x) => it.options.includes(x))]).toEqual([it.id, false]);
    }
  });

  test('letter_pick10: a vowel row never offers the vowel these children merge with it (a with e, o with u)', () => {
    const merged = { a: 'e', o: 'u' };
    for (const form of COACH_FORMS) {
      const t = byId(runtime(form, 'en'))['en.letter_pick10'];
      for (const it of t.items) if (merged[it.target]) expect([it.id, it.options.includes(merged[it.target])]).toEqual([it.id, false]);
    }
  });

  test('letter_pick10: a distractor is never the previous or the next item\'s target', () => {
    for (const form of COACH_FORMS) for (const l of ['ur', 'en']) {
      const items = byId(runtime(form, l))[`${l}.letter_pick10`].items;
      items.forEach((it, i) => {
        const near = [items[i - 1], items[i + 1]].filter(Boolean).map((x) => x.target);
        expect([it.id, it.options.filter((o) => o !== it.target && near.includes(o))]).toEqual([it.id, []]);
      });
    }
  });

  test('story_mcq_w3: no option is a second right answer by the passage (water is put in the plant; bathing and toys are care too)', () => {
    const opts = (id) => r28.mcq.questions[id].options;
    expect(opts('en.story_w3.q4')).not.toContain('Some water');
    expect(opts('en.story_w3.q2')).not.toContain('The teacher');
    expect(opts('ur.story2.q5').filter((o) => /نہلا|کھلونے/.test(o))).toEqual([]);
  });

  test('the tap tasks are titled «(سن کر چُنیں)» (listen and choose) in Urdu, never «ٹیپ»', () => {
    for (const form of COACH_FORMS) for (const lang of ['ur', 'en']) {
      const b = byId(runtime(form, lang));
      for (const l of ['ur', 'en']) {
        expect(b[`${l}.letter_pick10`].title.ur).toBe('حروف کی آوازیں (سن کر چُنیں)');
        expect(b[`${l}.story_mcq_w3`].title.ur).toBe('کہانی کے سوال (سن کر چُنیں)');
      }
    }
  });

  test('served OFF: no r28 task, no r28_tasks, no ext_items, base_n or ext_stop anywhere', () => {
    for (const form of COACH_FORMS) for (const lang of ['ur', 'en']) {
      for (const on of [{}, { rdfW3Forms: true }]) {
        const s = applySwitches(runtime(form, lang), on);
        expect(s.tasks.some((t) => t.r28)).toBe(false);
        const keys = keysDeep(s);
        for (const k of ['r28_tasks', 'ext_items', 'base_n', 'ext_stop']) expect([form, lang, k, keys.has(k)]).toEqual([form, lang, k, false]);
      }
    }
  });
});
