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
      expect([form, shown.length]).toEqual([form, grades45 ? 50 : 60]); // G1-3 run on past 42 (sa-number-id-g13-60.test.js)
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

  test('story_mcq_w3 practice: the passage carries its own clip, keyed on its unchanged text', () => {
    const key = (l, text) => `sa/v5/${l}/${require('crypto').createHash('sha1').update(`${l}|${text}`).digest('hex').slice(0, 12)}.mp3`;
    expect([key('ur', r28.mcq.practice.ur.passage), key('en', r28.mcq.practice.en.passage)])
      .toEqual(['sa/v5/ur/402c6898531d.mp3', 'sa/v5/en/6a1d9b5ad1c4.mp3']);
    const files = splitSaBankWithRuntime(buildSaBank({ v3, extra, w3, r28 }));
    for (const form of COACH_FORMS) for (const lang of ['ur', 'en']) {
      for (const b of [runtime(form, lang), JSON.parse(JSON.stringify(files[`sa/sa.${form}.${lang}.json`]))]) {
        for (const l of ['ur', 'en']) {
          const [p, ...more] = byId(b)[`${l}.story_mcq_w3`].practice;
          expect(more).toEqual([]);
          expect([form, lang, l, p.passage]).toEqual([form, lang, l, { text: r28.mcq.practice[l].passage, audio: key(l, r28.mcq.practice[l].passage) }]);
          expect(p.target_index).toBe(1);
        }
      }
    }
  });

  test('letter_pick10 practice: the second wrong tap NAMES the sound (the carrier, then the item\'s own clip); a right tap keeps the right line', () => {
    const v1 = (l, text) => `sa/v1/${l}/${require('crypto').createHash('sha1').update(`${l}|${text}`).digest('hex').slice(0, 12)}.mp3`;
    const CARRIER = { wrong: { en: 'The sound of this letter is:', ur: 'اس حرف کی آواز ہے:' } };
    for (const form of COACH_FORMS) for (const lang of ['ur', 'en']) {
      const b = runtime(form, lang);
      for (const l of ['ur', 'en']) {
        const t = byId(b)[`${l}.letter_pick10`];
        for (const p of t.practice) {
          const sound = { text: p.prompt_text, audio: p.prompt_audio, lang: l };
          const line = (k) => ({ text: CARRIER[k][lang], audio: v1(lang, CARRIER[k][lang]), lang });
          expect([form, lang, p.id, p.feedback]).toEqual([form, lang, p.id, { wrong: [line('wrong'), sound] }]);
          // the named sound is the one the child heard, never a letter name
          expect(p.feedback.wrong[1].audio).toBe(p.prompt_audio);
        }
      }
    }
  });

  // The task's language picks the example (Urdu «بَ», English isolated /b/); the battery's language picks the words.
  test('letter_pick10 intro: four lines, {Urdu, English task} × {Urdu, English battery}, each on its own clip', () => {
    const LINE = {
      ur: { ur: ['اب ایک سننے کا کھیل۔ جگنو ایک آواز بولے گا، جیسے «بَ»۔ جس حرف کی یہ آواز ہے اُس پر ٹیپ کریں۔ دوبارہ سننے کے لیے اسپیکر پر ٹیپ کریں۔', '8c9f5bc160d6'],
        en: ['Now a listening game. Jugnu will say an Urdu sound, like «بَ». Tap the letter for the first sound you hear. Tap the speaker to hear it again.', '8669cb4e1bb4'] },
      en: { ur: ['اب ایک سننے کا کھیل۔ جگنو انگریزی کی ایک آواز بولے گا، جیسے b کی آواز۔ جس حرف کی یہ آواز ہے اُس پر ٹیپ کریں۔ دوبارہ سننے کے لیے اسپیکر پر ٹیپ کریں۔', '095986edd89a'],
        en: ['Now a listening game. Jugnu will say a sound, like /b/. Tap the letter for the first sound you hear. Tap the speaker to hear it again.', '9274cd14bca9'] },
    };
    for (const form of COACH_FORMS) for (const lang of ['ur', 'en']) for (const task of ['ur', 'en']) {
      const t = byId(runtime(form, lang))[`${task}.letter_pick10`];
      const [text, key] = LINE[task][lang];
      const said = { text, audio: `sa/v5/${lang}/${key}.mp3` };
      expect(t.instruction).toEqual(said);
      expect(t.script.intro).toEqual(said);
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

/**
 * The EN familiar-word accept lists (the accent rule: a local form that keeps the same word is that word): forms ruled per
 * word, in the scorer's battery file only. The words prompt reads them from `record.items[k].accept` (its switch); a phone
 * never receives them, OFF or ON.
 */
describe('round 28 bank: EN familiar-word accept lists', () => {
  const { phoneSpecFor } = require('../../shared/services/child-test/sa/score');
  const lists = () => ((r28.word_accept || {})['en.words4'] || {}).forms || {};
  const WORDS = () => { const t = byId(runtime('coach.G3.A', 'en'))['en.words4']; return [...t.items, ...(t.ext_items || [])].map((x) => String(x.target)); };

  test('the bank rules forms for 76 of the 87 grid words, 131 forms, at most 4 a word, never the word itself', () => {
    const f = lists();
    expect(Object.keys(f).length).toBe(76);
    expect(Object.values(f).reduce((n, a) => n + a.length, 0)).toBe(131);
    const grid = WORDS().map((w) => w.toLowerCase());
    expect(grid.length).toBe(87);
    for (const [w, forms] of Object.entries(f)) {
      expect([w, grid.includes(w)]).toEqual([w, true]);
      expect(forms.length).toBeLessThanOrEqual(4);
      expect(forms.map((x) => x.toLowerCase())).not.toContain(w);
      expect(new Set(forms).size).toBe(forms.length);
    }
    // decoding errors stay wrong (come → some, up → cup, find → fan, sad → shed); go carries no form
    expect(f.come).not.toContain('some');
    expect(f.up).not.toContain('cup');
    expect(f.find).not.toContain('fan');
    expect(f.sad).not.toContain('shed');
    expect(f.go).toBeUndefined();
  });

  test('the battery files carry them on the EN words items and their extension, and the scorer\'s record reads them', () => {
    for (const form of COACH_FORMS) {
      const t = byId(runtime(form, 'en'))['en.words4'];
      expect(t.r28_accept).toBe(true);
      expect(t.items.map((x) => x.accept || null)).toEqual([null, ['said', 'sed', 'set'], ['ap'], ['fine', 'fain', 'fide']]);
      const come = t.ext_items.find((x) => x.target === 'come');
      expect(come.accept).toEqual(['kam', 'cam']);
      for (const x of [...t.items, ...t.ext_items]) expect(x.accept || null).toEqual(lists()[String(x.target).toLowerCase()] || null);
      for (const lang of ['ur', 'en']) {
        const ur = byId(runtime(form, lang))['ur.words4'];
        expect([ur.r28_accept, [...ur.items, ...(ur.ext_items || [])].some((x) => x.accept)]).toEqual([undefined, false]);
      }
    }
    // what the words prompt is handed: the phone's battery as the scorer loads it
    const load = (g, f, l) => runtime(`coach.G${g}.${f}`, l);
    const { spec } = phoneSpecFor({ grade: 3, form: 'A' }, { block: 'en.words4', lang: 'en' }, load);
    expect(spec.record.items.map((x) => x.accept || null)).toEqual([null, ['said', 'sed', 'set'], ['ap'], ['fine', 'fain', 'fide']]);
  });

  test('the counts source carries them too (sa_r8_counts serves today\'s 5th word from it), so the 5th word has its forms', () => {
    const { PLAN } = require('../../shared/services/child-test/sa/counts');
    const from = PLAN['en.words4'].add.from;
    for (const form of COACH_FORMS) for (const lang of ['ur', 'en']) {
      const src = byId(runtime(form, lang))[from];
      expect([form, lang, src.r28_accept]).toEqual([form, lang, true]);
      for (const x of src.items) expect([form, lang, x.target, x.accept || null]).toEqual([form, lang, x.target, lists()[String(x.target).toLowerCase()] || null]);
      const fifth = src.items.find((x) => /\.items\[4\]$/.test(String(x.src)));
      expect([fifth.target, fifth.accept]).toEqual(['come', ['kam', 'cam']]);
    }
  });

  test('a phone never receives them: no accept on a words item and no r28_accept, OFF and with every round-28 switch ON', () => {
    const ALL = { rdfW3Forms: true, r28LetterPick: true, r28Mcq: true, r28Ceiling: true, r28StoryClock: true };
    for (const form of COACH_FORMS) for (const lang of ['ur', 'en']) {
      for (const on of [{}, { rdfW3Forms: true }, ALL]) {
        const s = applySwitches(runtime(form, lang), on);
        for (const t of s.tasks.filter((x) => x && /words/.test(x.id))) {
          expect([form, lang, t.id, 'r28_accept' in t]).toEqual([form, lang, t.id, false]);
          expect([form, lang, t.id, [...(t.items || []), ...(t.ext_items || [])].filter((x) => 'accept' in x).length]).toEqual([form, lang, t.id, 0]);
        }
      }
    }
  });
});

describe('round 28 bank: the carried MCQ lures', () => {
  test('Bilal q2 offers «پہاڑ», not «بڑا پہاڑ» (the key is never STRICTLY the longest option; a tie is allowed)', () => {
    for (const id of ['ur.story_w3.q2', 'ur.story.q2']) expect(r28.mcq.questions[id].options).toEqual(['ریت', 'برف', 'پہاڑ', 'پانی']);
    for (const [id, q] of Object.entries(r28.mcq.questions)) {
      const key = q.options[q.target_index];
      const longest = Math.max(...q.options.filter((_, i) => i !== q.target_index).map((o) => [...o].length));
      expect([id, [...key].length <= longest]).toEqual([id, true]);
    }
  });

  test('«سکول» is spelled as the Urdu practice passage spells it, in every Urdu option', () => {
    expect(r28.mcq.questions['ur.story2.q4'].options).toContain('کیونکہ اسے سکول جانا تھا');
    expect(r28.mcq.practice.ur.passage).toMatch(/سکول/);
    const ur = Object.entries(r28.mcq.questions).filter(([id]) => id.startsWith('ur.')).flatMap(([, q]) => q.options);
    expect(ur.filter((o) => /اسکول/.test(o))).toEqual([]);
  });
});
