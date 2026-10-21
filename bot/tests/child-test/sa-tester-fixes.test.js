'use strict';

/**
 * The external tester's findings in the SA bank (the runtime batteries the engine runs):
 *   - languages never mix in one spoken line: a line naming an item of the other language is a chain of clips;
 *     English tasks carry no Arabic-script code point, Urdu tasks no Latin letter;
 *   - every maths task has practice (an official item in no scored set, a reused practice item, or a disabled demo copy);
 *   - the RDF short form on the coach forms;
 *   - pattern options are pictures when the sequence is.
 */

const path = require('path');
const fs = require('fs');

const DATA = path.join(__dirname, '../../shared/data/child-test');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));
const RUNTIMES = fs.readdirSync(path.join(DATA, 'sa')).filter((f) => /^sa\..+\.(en|ur)\.json$/.test(f));
const runtime = (f) => read(`sa/${f}`);
const task = (b, id) => b.tasks.find((t) => t.id === id);

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/u;
const LATIN = /[A-Za-z]/;

/** Every line the engine can speak in a task, as [where, text]. */
function spokenLines(t) {
  const out = [];
  const add = (where, x) => {
    if (x == null) return;
    if (Array.isArray(x)) { x.forEach((y, i) => add(`${where}[${i}]`, y)); return; }
    if (typeof x === 'string') { out.push([where, x]); return; }
    if (typeof x.text === 'string') out.push([where, x.text]);
  };
  for (const [k, v] of Object.entries(t.script || {})) if (k !== 'demo_image' && k !== 'demo_item') add(`script.${k}`, v);
  for (const list of ['items', 'practice']) {
    (t[list] || []).forEach((it, i) => {
      add(`${list}[${i}].say`, it.say);
      add(`${list}[${i}].prompt`, it.prompt);
      if (it.feedback) { add(`${list}[${i}].feedback.correct`, it.feedback.correct); add(`${list}[${i}].feedback.wrong`, it.feedback.wrong); }
    });
  }
  return out;
}

describe('A08: English and Urdu never mix', () => {
  test('no single spoken line holds both Arabic-script and Latin letters, in any battery on either page', () => {
    const bad = [];
    for (const f of RUNTIMES) {
      for (const t of runtime(f).tasks) {
        for (const [where, text] of spokenLines(t)) if (ARABIC.test(text) && LATIN.test(text)) bad.push(`${f} ${t.id} ${where}: ${text}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('every English task item, option, grid cell and spoken item is English only (no Arabic-script code point)', () => {
    const bad = [];
    for (const f of RUNTIMES) {
      for (const t of runtime(f).tasks.filter((x) => x.lang === 'en')) {
        const seen = [];
        for (const it of [...(t.items || []), ...(t.practice || [])]) {
          seen.push(it.target, ...(it.options || []), it.say, it.word, it.prompt && it.prompt.text);
          if (it.feedback) for (const k of ['correct', 'wrong']) [].concat(it.feedback[k] || []).filter((s) => s.lang === 'en').forEach((s) => seen.push(s.text));
        }
        seen.push(...(t.grid || []), t.passage && (t.passage.text || t.passage));
        for (const s of seen) if (s != null && ARABIC.test(String(s))) bad.push(`${f} ${t.id}: ${s}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('every Urdu task item, option, grid cell and spoken item carries no Latin letter', () => {
    const bad = [];
    for (const f of RUNTIMES) {
      for (const t of runtime(f).tasks.filter((x) => x.lang === 'ur')) {
        const seen = [];
        for (const it of [...(t.items || []), ...(t.practice || [])]) seen.push(...(it.options || []), it.say, it.word, it.prompt && it.prompt.text);
        seen.push(...(t.grid || []), t.passage && (t.passage.text || t.passage));
        for (const s of seen) if (s != null && typeof s === 'string' && !/^ur\.vocabulary\./.test(s) && LATIN.test(s)) bad.push(`${f} ${t.id}: ${s}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('on the Urdu page an English practice item\'s feedback is [Urdu carrier, English item clip]; on the English page it is one line', () => {
    const ur = task(runtime('sa.coach.G3.A.ur.json'), 'en.letters').practice[0];
    expect(Array.isArray(ur.feedback.correct)).toBe(true);
    const [carrier, item] = ur.feedback.correct;
    expect(carrier.lang).toBe('ur');
    expect(ARABIC.test(carrier.text) && !LATIN.test(carrier.text)).toBe(true);
    expect(item).toEqual(expect.objectContaining({ lang: 'en', text: ur.say }));
    expect(item.audio).toMatch(/^sa\/v1\/en\//);
    const en = task(runtime('sa.coach.G3.A.en.json'), 'en.letters').practice[0];
    expect(Array.isArray(en.feedback.correct)).toBe(false);
    expect(en.feedback.correct.text).toMatch(new RegExp(`${ur.say}\\.$`));
  });

  test('the two-item lines chain both items (initial sound on the Urdu page)', () => {
    const p = task(runtime('sa.coach.G3.A.ur.json'), 'en.initial_sound').practice[0];
    expect(p.feedback.correct.map((s) => s.lang)).toEqual(['ur', 'en', 'ur', 'en']);
    expect(p.feedback.correct[1].text).toBe(p.word);
  });

  test('an Urdu item on the English page: [English carrier, Urdu item clip]', () => {
    const p = task(runtime('sa.coach.G3.A.en.json'), 'ur.letters').practice[0];
    expect(p.feedback.wrong.map((s) => s.lang)).toEqual(['en', 'ur']);
    expect(p.feedback.wrong[0].text).toBe('This letter is:');
  });
});

describe('A11: practice before every maths task', () => {
  const content = (it) => JSON.stringify([it.target, it.label != null ? it.label : it.shown != null ? it.shown : null, typeof it.say === 'string' ? it.say : null, it.prompt ? it.prompt.text : null]);
  test('with the switch on (practice_v2 where given), every ma.* task has practice or a disabled demo copy of item 1', () => {
    const bad = [];
    for (const f of RUNTIMES) {
      for (const t of runtime(f).tasks.filter((x) => x.id.startsWith('ma.'))) {
        const practice = t.practice_v2 || t.practice;
        if (!practice.length && !(t.script && t.script.demo_item)) bad.push(`${f} ${t.id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('no practice item repeats a scored item of the same form, and every practice item has a src', () => {
    const bad = [];
    for (const f of RUNTIMES) {
      const b = runtime(f);
      const scored = new Set(b.tasks.filter((x) => x.id.startsWith('ma.')).flatMap((t) => t.items.map((it) => `${t.response}|${content(it)}`)));
      for (const t of b.tasks.filter((x) => x.id.startsWith('ma.'))) {
        for (const p of t.practice_v2 || t.practice) {
          if (!p.src) bad.push(`${f} ${t.id} ${p.id}: no src`);
          if (scored.has(`${t.response}|${content(p)}`)) bad.push(`${f} ${t.id} ${p.id}: scored`);
          if (t.items.some((it) => it.id === p.id)) bad.push(`${f} ${t.id} ${p.id}: id`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  test('the panel\'s table: number ID 1, add 1 + 4, take away 5 − 1, 13 + 4, 18 − 1, fluency 2 + 2; reuse and demo copies', () => {
    const b = runtime('sa.coach.G5.A.en.json');
    const p = (id) => (task(b, id).practice_v2 || task(b, id).practice)[0];
    expect(p('ma.number_id').target).toBe(1);
    expect([p('ma.add1').shown, p('ma.add1').target]).toEqual(['1 + 4 =', 5]);
    expect([p('ma.sub1').shown, p('ma.sub1').target]).toEqual(['5 - 1 =', 4]);
    expect([p('ma.add2').shown, p('ma.add2').target]).toEqual(['13 + 4 =', 17]);
    expect([p('ma.sub2').shown, p('ma.sub2').target]).toEqual(['18 - 1 =', 17]);
    expect([p('ma.fluency_l34').shown, p('ma.fluency_l34').target]).toEqual(['2 + 2 =', 4]);
    expect(p('ma.number_id_upper').target).toBe('66');
    expect(p('ma.word_problems_l2').target).toBe(task(b, 'ma.word_problems').practice[0].target);
    expect(p('ma.ordering').shown).toEqual([1, 2, null, 4]);
    for (const id of ['ma.patterns', 'ma.patterns_hi', 'ma.number_repr']) {
      const d = task(b, id).script.demo_item;
      expect([id, d.disabled, d.target]).toEqual([id, true, undefined]);
      expect(d.id).toBe(`${task(b, id).items[0].id}.demo`);
    }
    // Official practice is kept where printed.
    expect(p('ma.missing').src).toMatch(/practice/);
    // Every practice item that gives feedback has it in the page language.
    expect(p('ma.add1').feedback.correct.text).toBe('That is right, 5.');
    expect(task(runtime('sa.coach.G5.A.ur.json'), 'ma.add1').practice_v2[0].feedback.wrong.text).toBe('جواب ۵ ہے۔');
  });

  test('switch OFF data is today\'s: practice is unchanged and the new practice rides in practice_v2', () => {
    const b = runtime('sa.coach.G3.A.en.json');
    expect(task(b, 'ma.add1').practice).toEqual([]);
    expect(task(b, 'ma.add1').practice_v2.length).toBe(1);
    expect(task(b, 'ma.missing').practice_v2).toBeUndefined();
  });
});

describe('A14: the RDF short form', () => {
  const RDF = ['ur.letter_sounds_rec', 'ur.words_rec', 'ur.story', 'ur.story_comp', 'en.letter_sounds_rec', 'en.words_rec', 'en.story', 'en.story_comp',
    'ma.number_id', 'ma.missing', 'ma.add1', 'ma.sub1', 'ma.word_problems'];
  test.each(['sa.coach.G3.A.ur.json', 'sa.coach.G3.A.en.json', 'sa.coach.G5.A.ur.json', 'sa.coach.G5.A.en.json'])('%s carries rdf[] = the ruled list, each task present', (f) => {
    const b = runtime(f);
    expect(b.rdf).toEqual(RDF);
    expect(b.rdf_items).toEqual({ 'ma.word_problems': 3, 'ur.story_comp': { drop: ['ur.story.q4'] }, 'en.story_comp': { drop: ['en.story.q4'] } });
    // C2: the Set A questions RDF asks are lit1-3 + inf1-2, in order (RWP rdcomp_lit4 dropped).
    for (const l of ['ur', 'en']) {
      const kept = task(b, `${l}.story_comp`).items.filter((q) => !b.rdf_items[`${l}.story_comp`].drop.includes(q.id));
      expect(kept.map((q) => q.src.replace(/^.*questions/, ''))).toEqual(['[0]', '[1]', '[2]', '[4]', '[5]']);
    }
    expect(b.rdf_name).toEqual({ en: 'RDF', ur: 'آر ڈی ایف' });
    for (const id of RDF) expect([id, !!task(b, id)]).toEqual([id, true]);
    // The record-only tasks are RDF's: the full battery does not run them.
    expect(b.full.filter((id) => /_rec$/.test(id))).toEqual([]);
  });

  test('letter sounds in RDF are recorded on the official letter grids (60 s), with the sound instruction', () => {
    const b = runtime('sa.coach.G3.A.ur.json');
    const ur = task(b, 'ur.letter_sounds_rec');
    expect([ur.response, ur.time_limit_s, ur.lang, ur.subtask]).toEqual(['record', 60, 'ur', 'letter_sound_identification']);
    expect(ur.grid).toEqual(task(b, 'ur.letters').grid);
    expect(ur.instruction.text).toMatch(/آواز/);
    expect(ur.items).toEqual([]);
    const en = task(b, 'en.letter_sounds_rec');
    expect(en.grid).toEqual(task(b, 'en.letter_sounds').grid);
    expect(read('item-bank.sa.v1.json').tasks['coach.G3.A/en.letter_sounds_rec'].source.items).toBe('extra:reading.en.letter_sounds');
  });

  test('C1: familiar words in RDF are read aloud on the official word grids (60 s, per minute), not tapped', () => {
    const b = runtime('sa.coach.G5.A.ur.json');
    for (const l of ['ur', 'en']) {
      const w = task(b, `${l}.words_rec`);
      expect([w.response, w.time_limit_s, w.subtask, w.items]).toEqual(['record', 60, 'familiar_word_reading', []]);
      expect(w.grid).toEqual(task(b, `${l}.words`).grid);
      expect(w.deviation).toMatch(/^none \(EGRA read-aloud\)/);
      expect(b.full.includes(`${l}.words_rec`)).toBe(false);
    }
  });

  test('the game forms have no RDF', () => {
    for (const f of RUNTIMES.filter((x) => x.startsWith('sa.game.'))) expect(runtime(f).rdf).toBeUndefined();
  });
});

describe('A13: pattern options as pictures', () => {
  test('levels 1-2 word options carry the same glyph as the sequence, numerals none; Jugnu says the four options', () => {
    for (const lang of ['en', 'ur']) {
      const t = task(runtime(`sa.coach.G3.A.${lang}.json`), 'ma.patterns');
      for (const id of ['ma.patterns.1a', 'ma.patterns.2a', 'ma.patterns.2b']) {
        const it = t.items.find((x) => x.id === id);
        expect(it.glyphs.every((g) => typeof g === 'string' && g.length > 0)).toBe(true);
        for (const o of it.options) expect([id, it.say.includes(o)]).toEqual([id, true]);
      }
      const n = t.items.find((x) => x.id === 'ma.patterns.1b');
      expect(n.glyphs.every((g) => g === null)).toBe(true);
    }
    // RULING #44 addendum 2: RWP's printed blank ends each "what comes next" row, so the gap marks the reading
    // direction on both pages; 4a's printed ___ is the same gap.
    for (const f of ['sa.coach.G3.A.en.json', 'sa.coach.G3.A.ur.json', 'sa.game.G45.ur.json']) {
      const b = runtime(f);
      const items = [...task(b, 'ma.patterns').items, ...task(b, 'ma.patterns_hi').items];
      for (const id of ['1a', '1b', '2a', '2b', '4b']) {
        const it = items.find((x) => x.id === `ma.patterns.${id}`);
        expect([f, id, it.shown[it.shown.length - 1]]).toEqual([f, id, null]);
        expect(it.shown.filter((x) => x === null)).toHaveLength(1);
      }
      expect(items.find((x) => x.id === 'ma.patterns.4a').shown).toEqual(['40', '30', null, '10', '0']);
      for (const id of ['3a', '3b']) expect(items.find((x) => x.id === `ma.patterns.${id}`).shown.includes(null)).toBe(false);
    }
    // Numerals on screen are Western digits on both pages (the maths convention), options as the sequence.
    const n1b = task(runtime('sa.coach.G3.A.ur.json'), 'ma.patterns').items.find((x) => x.id === 'ma.patterns.1b');
    expect([n1b.options, n1b.target, n1b.shown.slice(0, 2)]).toEqual([['1', '2', '3', '0'], '1', ['2', '2']]);
    expect(task(runtime('sa.coach.G3.A.en.json'), 'ma.patterns').items.find((x) => x.id === 'ma.patterns.1a').say)
      .toBe('What comes next? circle, triangle, circle, triangle: star, triangle, circle, or square?');
  });
});

describe('A02: passages from tested sources, rotating per child', () => {
  const ids = (t) => t.variants.map((v) => v.id);
  test.each(['sa.coach.G3.A.ur.json', 'sa.coach.G5.A.en.json'])('%s: Urdu rotates RWP, SELECT, PRP-KP; English RWP + the TK2009 sample (named unfielded)', (f) => {
    const b = runtime(f);
    for (const id of ['ur.story', 'ur.story_comp', 'ur.listening']) expect([id, ids(task(b, id))]).toEqual([id, ['rwp2026', 'select2024', 'prpkp2020']]);
    for (const id of ['en.story', 'en.story_comp', 'en.listening']) expect([id, ids(task(b, id))]).toEqual([id, ['rwp2026', 'tk2009']]);
    for (const t of b.tasks.filter((x) => x.variants)) {
      for (const v of t.variants) {
        expect([t.id, v.id, !!v.src, typeof v.fielded]).toEqual([t.id, v.id, true, 'boolean']);
        expect(v.items.length).toBeGreaterThan(0);
      }
      // Variant 0 is the form's own text: OFF and ON agree for the child who gets index 0.
      expect(t.variants[0].items).toEqual(t.items);
    }
    expect(task(b, 'en.story').variants[1].fielded).toBe(false);
  });

  test('PRP-KP: the assessor grid\'s five sentences are the lines (first line = 9 words), each question asks up to its sentence', () => {
    const b = runtime('sa.coach.G3.A.ur.json');
    const v = task(b, 'ur.story').variants[2];
    expect(v.items).toHaveLength(60);
    expect(v.passage.lines.map((l) => l.to - l.from + 1)).toEqual([9, 21, 11, 9, 10]);
    expect(v.stop).toEqual({ first_line_n: 9, first_line_min_correct: 1 });
    const q = task(b, 'ur.story_comp').variants[2].items;
    expect(q.map((x) => x.needs_line)).toEqual([1, 2, 3, 4, 5]);
    expect(q.every((x) => x.prompt && x.prompt.audio && x.accept.length)).toBe(true);
    const l = task(b, 'ur.listening').variants[2];
    expect([l.passage.read_times, l.items.length]).toEqual([1, 3]);
  });

  test('no generated passage enters the battery', () => {
    const gen = fs.readdirSync(path.join(DATA, 'passages')).filter((f) => f.endsWith('.json')).map((f) => read(`passages/${f}`)).filter((p) => p.licence === 'generated');
    expect(gen.length).toBeGreaterThan(30);
    const texts = new Set(gen.map((p) => String(p.text || '').slice(0, 40)).filter(Boolean));
    for (const f of RUNTIMES) {
      for (const t of runtime(f).tasks) {
        for (const v of [t, ...(t.variants || [])]) {
          const s = v.passage && (v.passage.text || v.passage);
          if (typeof s === 'string') expect([f, t.id, texts.has(s.slice(0, 40))]).toEqual([f, t.id, false]);
        }
      }
    }
  });

  test('the game forms keep their islands\' passages (no rotation there)', () => {
    for (const f of RUNTIMES.filter((x) => x.startsWith('sa.game.'))) expect(runtime(f).tasks.filter((t) => t.variants)).toEqual([]);
  });
});
