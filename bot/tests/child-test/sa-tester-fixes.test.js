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
  test('with the switch on (practice_v2 where given), every ma.* task has an interactive practice item with feedback', () => {
    const bad = [];
    for (const f of RUNTIMES) {
      // W3's spoken maths tasks practise with a model answer instead (sa-rdf-w3.test.js)
      for (const t of runtime(f).tasks.filter((x) => x.id.startsWith('ma.') && !x.w3)) {
        const practice = (t.practice_v2 || t.practice).filter((p) => !p.disabled && p.target != null && p.feedback && p.feedback.correct && p.feedback.wrong);
        if (!practice.length) bad.push(`${f} ${t.id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('the panel\'s practice for patterns, patterns 2 and tens and hundreds: the scored items\' own formats, then Core EGMA P1', () => {
    for (const f of RUNTIMES.filter((x) => /^sa\.coach\./.test(x))) {
      const b = runtime(f);
      const ur = /\.ur\.json$/.test(f);
      // Patterns: one authored AB picture row in item 1a's format, picture options.
      const pat = task(b, 'ma.patterns').practice_v2;
      expect(pat).toHaveLength(1);
      expect([pat[0].id, pat[0].shown, pat[0].glyphs, pat[0].option_keys, pat[0].practice, pat[0].src])
        .toEqual(['ma.patterns.p1', ['★', '■', '★', '■', null], ['★', '▲', '●', '■'], ['star', 'triangle', 'circle', 'square'], true, 'authored:practice']);
      expect(pat[0].target).toBe(ur ? 'ستارہ' : 'star');
      expect(pat[0].say).toBe(ur ? 'آگے کیا آئے گا؟ ستارہ، چوکور، ستارہ، چوکور: ستارہ، تکون، دائرہ یا چوکور؟'
        : 'What comes next? star, square, star, square: star, triangle, circle, or square?');
      expect([pat[0].feedback.correct.text, pat[0].feedback.wrong.text]).toEqual(ur
        ? ['بالکل ٹھیک، ستارہ۔', 'اگلا ستارہ ہے۔ ستارہ، چوکور، ستارہ، چوکور، ستارہ۔']
        : ['That is right, star.', 'Star comes next. Star, square, star, square, star.']);
      // Patterns 2: the authored "how many times" row in 3a's format, then Core EGMA's printed P1 for the number rows.
      const hi = task(b, 'ma.patterns_hi').practice_v2;
      expect(hi.map((p) => [p.id, p.shown, String(p.target), p.options])).toEqual([
        ['ma.patterns_hi.p1', ['⭐', '🟢', '⭐', '🟢', '⭐', '🟢'], '3', undefined],
        ['ma.patterns_hi.p2', [1, 2, null, 4], '3', undefined]]);
      expect([hi[0].src, hi[0].practice]).toEqual(['authored:practice', true]);
      expect(hi[1].src).toMatch(/^core_egma:p\.4 P1 .*missing\.practice\[0\]/);
      // Panel P2-a: the number row is spoken in 4a's frame and is marked practice.
      expect([hi[1].practice, hi[1].say]).toEqual([true, ur ? 'کون سا نمبر غائب ہے؟ ۱، ۲، خالی، ۴' : 'What number is missing? 1, 2, blank, 4']);
      expect(hi[0].say).toBe(ur ? 'نیچے دی گئی ترتیب کو دیکھیں۔ اس میں ستارہ اور دائرہ، یہ دونوں ایک ساتھ کتنی بار آئے ہیں؟'
        : 'Look at the pattern below. How many times does star, circle repeat in the pattern?');
      expect(hi[0].feedback.wrong.text).toBe(ur ? 'ستارہ دائرہ: ایک۔ ستارہ دائرہ: دو۔ ستارہ دائرہ: تین۔ جواب ۳ ہے۔'
        : 'Star, circle: one. Star, circle: two. Star, circle: three. The answer is 3.');
      // Tens and hundreds: one authored example, the teaching wrong line.
      const [rep] = task(b, 'ma.number_repr').practice_v2;
      expect([rep.target, rep.practice, rep.src, rep.options]).toEqual(['3', true, 'authored:practice', undefined]);
      expect(rep.say).toBe(ur ? '۳۰ میں کتنی دہائیاں ہیں؟' : 'How many tens are in 30?');
      expect([rep.feedback.correct.text, rep.feedback.wrong.text]).toEqual(ur
        ? ['بالکل ٹھیک، ۳۔', '۳۰ میں ۳ دہائیاں ہیں۔ جواب ۳ ہے۔'] : ['That is right, 3.', '30 is 3 tens. The answer is 3.']);
      // The item-1 demo stays after the practice.
      for (const id of ['ma.patterns', 'ma.patterns_hi', 'ma.number_repr']) expect(task(b, id).script.demo_item.disabled).toBe(true);
    }
  });

  // Patterns 2's second practice is Core EGMA P1 by the panel's choice, the same screen as missing number's P1.
  test('no new practice screen (patterns, the authored items) is another maths task\'s practice screen in the same form', () => {
    const bad = [];
    for (const f of RUNTIMES) {
      const seen = new Map();
      for (const t of runtime(f).tasks.filter((x) => x.id.startsWith('ma.'))) {
        for (const p of t.practice_v2 || t.practice) {
          const k = JSON.stringify([p.shown, p.target, p.options ? [...p.options].sort() : null, typeof p.say === 'string' ? p.say : null]);
          if (seen.has(k) && seen.get(k) !== t.id && (t.id === 'ma.patterns' || p.src === 'authored:practice')) bad.push(`${f} ${t.id} ${p.id} = ${seen.get(k)}`);
          if (!seen.has(k)) seen.set(k, t.id);
        }
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
  // W3: PRP-KP's story left the oral-reading rotation (its report prints no punctuation); its listening story stays.
  test.each(['sa.coach.G3.A.ur.json', 'sa.coach.G5.A.en.json'])('%s: Urdu reads RWP, SELECT and listens to RWP, SELECT, PRP-KP; English RWP + the TK2009 sample (named unfielded)', (f) => {
    const b = runtime(f);
    for (const id of ['ur.story', 'ur.story_comp']) expect([id, ids(task(b, id))]).toEqual([id, ['rwp2026', 'select2024']]);
    expect(ids(task(b, 'ur.listening'))).toEqual(['rwp2026', 'select2024', 'prpkp2020']);
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

  test('PRP-KP: its story is out of the reading rotation (unpunctuated in the report), kept on file; its listening story still rotates', () => {
    const b = runtime('sa.coach.G3.A.ur.json');
    for (const id of ['ur.story', 'ur.story_comp']) expect(ids(task(b, id))).not.toContain('prpkp2020');
    const s3 = read('item-bank.sa-extra.v1.json').reading.ur.story3;
    expect([s3.editorial_punct, s3.lines.flatMap((t) => t.split(/\s+/)).length]).toEqual([true, 60]);
    const l = task(b, 'ur.listening').variants[2];
    expect([l.id, l.passage.read_times, l.items.length]).toEqual(['prpkp2020', 1, 3]);
    expect(l.passage.text).toContain('آئیندہ');
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

describe('RULING #31d: every line Jugnu says has a clip (the engine\'s own lines in the bank)', () => {
  const { COPY } = require('../../../dashboard/sa/sa-ui.js');
  const NAMES = ['right', 'try_again', 'shown', 'mic_skip_say', 'warm_title', 'last_word', 'all_done', 'back_wait', 'mic_skip_task', 'give_coach'];
  test.each(['en', 'ur'])('every battery in %s carries the 10 lines, text exactly the engine\'s, each with its clip', (lang) => {
    for (const f of RUNTIMES.filter((x) => x.endsWith(`.${lang}.json`))) {
      const b = runtime(f);
      for (const k of NAMES) {
        expect([f, k, b.lines[k] && b.lines[k].text]).toEqual([f, k, COPY[lang][k]]);
        expect(b.lines[k].audio).toMatch(new RegExp(`^sa/v1/${lang}/[0-9a-f]{12}\\.mp3$`));
      }
    }
  });
});
