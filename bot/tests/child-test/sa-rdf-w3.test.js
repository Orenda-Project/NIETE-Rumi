'use strict';

/**
 * The RDF auto and RDF manual forms (switch sa_rdf_w3_forms, default OFF). Both run the same short battery on the coach
 * forms, built from item-bank.sa-w3.v1.json (every item official, with its src): reading = letter names 5, letter
 * sounds 5 (only letters with a sound of their own), familiar words 4, the passage with its official punctuation and
 * its questions (no blending: no official EGRA has the task, and the form says so with its citations); maths = number
 * identification 8, quantity comparison 2, missing number 4, addition 2, subtraction 2, multiplication 2, one minute of
 * oral fluency (20 items). Letters, words, numbers and sums show one item at a time. Manual = the same tasks; every
 * task carries the official administration wording the coach reads out (coach_text), and Jugnu says only
 * lines.coach_will_instruct.
 */

const path = require('path');
const fs = require('fs');

const DATA = path.join(__dirname, '../../shared/data/child-test');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));
const { buildSaBank, splitSaBankWithRuntime, runtimeBattery } = require('../../shared/services/child-test/sa/build');
const { W3_TASKS } = require('../../shared/services/child-test/sa/build-w3');
const { applySwitches } = require('../../../dashboard/routes/sa-battery-switches');
const { voiceManifest } = require('../../shared/services/child-test/sa/voice-manifest');

const v3 = require('../../shared/data/child-test/item-bank.v3.json');
const extra = require('../../shared/data/child-test/item-bank.sa-extra.v1.json');
const w3 = require('../../shared/data/child-test/item-bank.sa-w3.v1.json');

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/u;
const GENDERED_TO_CHILD = /(گا\/گی|گے\/گی|تا\/تی|تے\/تی|سکتے ہیں|سکتی ہیں)/u;
const COACH_FORMS = ['coach.G1.A', 'coach.G2.A', 'coach.G3.A', 'coach.G4.A', 'coach.G5.A'];
const COUNTS = {
  letter_names5: 5, letter_sounds5: 5, words4: 4,
  'ma.number_id8': 8, 'ma.discrimination2': 2, 'ma.missing4': 4, 'ma.add2i': 2, 'ma.sub2i': 2, 'ma.mul2i': 2,
};
const kindOf = (id) => (id.startsWith('ma.') ? id : id.split('.')[1]);

function strings(x, out = [], key = '') {
  if (typeof x === 'string') out.push([key, x]);
  else if (Array.isArray(x)) x.forEach((v, i) => strings(v, out, `${key}[${i}]`));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) strings(v, out, `${key}.${k}`);
  return out;
}

const runtime = (form, lang) => read(`sa/sa.${form}.${lang}.json`);
const w3Of = (b) => b.tasks.filter((t) => t.w3);

describe('RDF auto / RDF manual forms (Wave 3)', () => {
  test('each coach form lists rdf_auto and rdf_manual (the same tasks), named, manual flagged', () => {
    for (const form of COACH_FORMS) for (const lang of ['ur', 'en']) {
      const b = runtime(form, lang);
      expect(b.rdf_auto.length).toBeGreaterThan(0);
      expect(b.rdf_manual).toEqual(b.rdf_auto);
      expect(b.rdf_variants.rdf_auto.manual).toBe(false);
      expect(b.rdf_variants.rdf_manual.manual).toBe(true);
      for (const v of Object.values(b.rdf_variants)) expect(v.name.en && v.name.ur).toBeTruthy();
      const ids = new Set(b.tasks.map((t) => t.id));
      for (const id of b.rdf_auto) expect([id, ids.has(id)]).toEqual([id, true]);
      expect(b.rdf_auto).toEqual(W3_TASKS.filter((id) => ids.has(id)));
    }
  });

  test('the operator\'s counts, UR and EN alike: letter names 5, sounds 5, words 4; maths 8/2/4/2/2/2', () => {
    for (const form of COACH_FORMS) {
      const b = runtime(form, 'ur');
      const byId = Object.fromEntries(b.tasks.map((t) => [t.id, t]));
      for (const lang of ['ur', 'en']) {
        for (const k of ['letter_names5', 'letter_sounds5', 'words4']) expect([`${lang}.${k}`, byId[`${lang}.${k}`].items.length]).toEqual([`${lang}.${k}`, COUNTS[k]]);
        // RULING W3-2: no official EGRA has a blending task, so there is none, and the form cites why.
        expect(byId[`${lang}.blending2`]).toBeUndefined();
        expect(b.rdf_w3_absent.blending[lang]).toMatch(/No blending task/);
        expect(byId[`${lang}.story_w3`].items.length).toBeGreaterThan(0);
        expect(byId[`${lang}.story_comp_w3`].items.length).toBeGreaterThan(0);
      }
      for (const k of ['ma.number_id8', 'ma.discrimination2', 'ma.missing4', 'ma.add2i', 'ma.sub2i', 'ma.mul2i']) expect([k, byId[k].items.length]).toEqual([k, COUNTS[k]]);
      const fl = byId['ma.fluency1m'];
      expect(fl.time_limit_s).toBe(60);
      expect(fl.items.length).toBe(20);
      expect(fl.response).toBe('record');
      expect(byId['ma.mul2i'].items.map((it) => it.src)).toEqual(['rwp2026:blfluency.blfl4[10] (3*4 = 12)', 'rwp2026:bleffcomp.computation_3a (8 x 9 = 72)']);
    }
  });

  test('letters, words, numbers and sums show one item at a time, recorded; a silent item moves on after 3 s / 5 s', () => {
    const b = runtime('coach.G3.A', 'ur');
    const one = w3Of(b).filter((x) => /letter_names5|letter_sounds5|words4|number_id8|add2i|sub2i|mul2i|fluency1m/.test(x.id));
    expect(one.length).toBe(11);
    for (const t of one) {
      expect([t.id, t.present, t.response]).toEqual([t.id, 'one_at_a_time', 'record']);
      for (const it of t.items) expect([it.id, typeof it.show]).toEqual([it.id, 'string']);
    }
    for (const t of one.filter((x) => /letter|words/.test(x.id))) {
      expect([t.id, t.grid, t.time_limit_s, t.advance_after_s]).toEqual([t.id, t.items.map((it) => it.show), 60, 3]);
    }
    for (const id of ['ma.number_id8', 'ma.fluency1m']) expect(b.tasks.find((t) => t.id === id).advance_after_s).toBe(5);
    expect(b.tasks.find((t) => t.id === 'ma.fluency1m').items.map((it) => it.show).slice(0, 2)).toEqual(['1 + 4', '2 + 2']);
  });

  test('every item and practice item carries its src, and a src names a source the bank lists', () => {
    for (const form of COACH_FORMS) for (const lang of ['ur', 'en']) {
      const b = runtime(form, lang);
      for (const t of w3Of(b)) {
        const variantItems = (t.variants || []).flatMap((v) => v.items);
        for (const it of [...t.items, ...(t.practice || []), ...variantItems]) expect([t.id, it.id, typeof it.src, !!it.src]).toEqual([t.id, it.id, 'string', true]);
        expect([t.id, !!(t.source && t.source.items)]).toEqual([t.id, true]);
      }
    }
    const known = new Set(Object.keys(w3.sources));
    for (const [key, s] of strings(w3)) {
      if (!/\.src$/.test(key) || /^(authored|v3|extra):/.test(s)) continue;
      expect([key, known.has(s.split(':')[0])]).toEqual([key, true]);
    }
  });

  test('letter-sound items use only letters with a sound of their own (the published Urdu EGRA\'s rule)', () => {
    const none = new Set(w3.reading.ur.letter_sounds.no_sound_of_own || []);
    expect(none.has('ء')).toBe(true);
    const b = runtime('coach.G3.A', 'ur');
    const t = b.tasks.find((x) => x.id === 'ur.letter_sounds5');
    expect(t.items.map((it) => it.show)).toEqual(['ب', 'م', 'ک', 'س', 'ر']);
    expect(t.practice.map((it) => it.show)).toEqual(['ل', 'ن']);
    expect(b.tasks.find((x) => x.id === 'ur.letter_names5').items.map((it) => it.show)).toEqual(['د', 'ج', 'پ', 'ت', 'ا']);
    for (const it of [...t.items, ...t.practice]) expect([it.show, none.has(it.show)]).toEqual([it.show, false]);
    // the names and the sounds are separate sets (the Toolkit gives them separate grids)
    const names = new Set(b.tasks.find((x) => x.id === 'ur.letter_names5').items.map((it) => it.show));
    for (const it of t.items) expect(names.has(it.show)).toBe(false);
    const en = runtime('coach.G3.A', 'en').tasks;
    // F5: the practice letters T M S are in neither scored set
    expect(en.find((x) => x.id === 'en.letter_names5').items.map((it) => it.show)).toEqual(['i', 'y', 'E', 'O', 'A']);
    expect(en.find((x) => x.id === 'en.letter_sounds5').items.map((it) => it.show)).toEqual(['L', 'h', 'R', 'n', 'D']);
    const enNames = new Set(en.find((x) => x.id === 'en.letter_names5').items.map((it) => it.show.toLowerCase()));
    for (const it of en.find((x) => x.id === 'en.letter_sounds5').items) expect(enNames.has(it.show.toLowerCase())).toBe(false);
  });

  test('the passage is the official Set A text with its punctuation; each word carries its own token, every variant too', () => {
    for (const lang of ['ur', 'en']) {
      const t = runtime('coach.G3.A', lang).tasks.find((x) => x.id === `${lang}.story_w3`);
      expect(t.passage.text).toBe(v3.sets.A.reading[lang].story.story.text);
      expect(/[.,?!۔،؟]/u.test(t.passage.text)).toBe(true);
      expect(t.passage.print_lines.join(' ')).toBe(t.passage.text);
      for (const v of [t, ...(t.variants || [])]) {
        const text = v.passage.text;
        // the words, with their punctuation, rebuild the text; the scored targets are unchanged
        expect(v.items.map((w) => w.text).join(' ')).toBe(text.replace(/\s+/g, ' ').trim());
        const bare = (x) => x.replace(/[.,!?“”"‘’:;۔،؟()]/gu, '').replace(/[\u064B-\u065F\u0670]/gu, '');
        for (const w of v.items) expect([w.id, bare(w.text)]).toEqual([w.id, bare(w.target)]);
      }
      // W3 rotates only passages with official punctuation (ITEMS_W3): UR RWP + SELECT, EN RWP alone
      expect((t.variants || []).map((v) => v.id)).toEqual(lang === 'ur' ? ['rwp2026', 'select2024'] : []);
      expect(t.depends_on.task).toBe(`${lang}.words4`);
      expect(runtime('coach.G3.A', lang).tasks.find((x) => x.id === `${lang}.story_comp_w3`).depends_on.task).toBe(`${lang}.story_w3`);
    }
  });

  test('manual: every task has the coach\'s words in the page language; Jugnu\'s one line exists in UR and EN', () => {
    for (const form of COACH_FORMS) for (const lang of ['ur', 'en']) {
      const b = runtime(form, lang);
      expect(b.lines.coach_will_instruct.text).toBeTruthy();
      expect(b.lines.coach_will_instruct.audio).toMatch(new RegExp(`^sa/v1/${lang}/[0-9a-f]{12}\\.mp3$`));
      for (const t of w3Of(b)) expect([t.id, typeof t.coach_text.text, t.coach_text.text.length > 10]).toEqual([t.id, 'string', true]);
    }
    expect(runtime('coach.G3.A', 'en').lines.coach_will_instruct.text).toBe('Your coach will now give the instructions.');
  });

  test('A08: on the English page every English task\'s words are English only (no Arabic-script code point)', () => {
    for (const form of COACH_FORMS) {
      const b = runtime(form, 'en');
      for (const t of w3Of(b).filter((x) => x.lang !== 'ur')) {
        // accept / reject / rubric are the scorer's keys (a child may answer in Urdu), never shown or said
        for (const [key, s] of strings({ items: t.items, practice: t.practice, script: t.script, coach: t.coach_text, passage: t.passage, title: t.title.en })
          .filter(([k]) => !/\.(accept|reject)\[\d+\]$|\.rubric$/.test(k))) {
          expect([t.id, key, ARABIC.test(s)]).toEqual([t.id, key, false]);
        }
      }
      expect(ARABIC.test(b.lines.coach_will_instruct.text)).toBe(false);
    }
  });

  test('Jugnu\'s Urdu to the child has nothing gendered (the coach reads the official wording, which offers both forms)', () => {
    for (const t of Object.values(buildSaBank({ v3, extra, w3 }).tasks).filter((x) => x.w3)) {
      for (const [key, s] of strings({ script: t.script, models: (t.practice || []).map((p) => p.model) })) expect([t.task, key, GENDERED_TO_CHILD.test(s)]).toEqual([t.task, key, false]);
    }
  });

  test('the voice manifest holds every new clip key (item prompts and the coach line), both ways', () => {
    const bank = buildSaBank({ v3, extra, w3 });
    const keys = new Set(voiceManifest(bank).map((r) => r.key));
    expect(keys.has(bank.lines.coach_will_instruct.audio.ur)).toBe(true);
    expect(keys.has(bank.lines.coach_will_instruct.audio.en)).toBe(true);
    let n = 0;
    for (const t of Object.values(bank.tasks).filter((x) => x.w3)) {
      for (const [, a] of strings({ items: t.items, practice: t.practice, script: t.script }).filter(([k]) => /audio(\.(en|ur))?$/.test(k))) {
        n += 1;
        expect([t.task, a, keys.has(a)]).toEqual([t.task, a, true]);
      }
    }
    expect(n).toBeGreaterThan(100);
  });

  test('the questions: the Set A card\'s accept lists (never narrower), its rule, and a gate per question', () => {
    const gates = { ur: [1, 23, 30, 55, 44, 55], en: [1, 12, 20, 48, 55, 60] };
    for (const lang of ['ur', 'en']) {
      const b = runtime('coach.G3.A', lang);
      const own = v3.sets.A.reading[lang].story.questions;
      const q = b.tasks.find((x) => x.id === `${lang}.story_comp_w3`).items;
      expect(q.map((x) => x.gate.min_words)).toEqual(gates[lang]);
      q.forEach((x, i) => {
        expect(x.accept_rule).toBe('same meaning, either language');
        for (const a of own[i].accept) expect(x.accept).toContain(a);
      });
    }
  });

  test('the counts and maths values are ITEMS_W3\'s (Core EGMA Task 1 cells 2 and 4 of each row; Task 2 items 2 and 6)', () => {
    const b = runtime('coach.G5.A', 'en');
    const ids = (id) => b.tasks.find((x) => x.id === id).items;
    expect(ids('ma.number_id8').map((it) => it.show)).toEqual(['9', '12', '45', '23', '33', '87', '245', '731']);
    expect(ids('ma.discrimination2').map((it) => it.options)).toEqual([[11, 24], [94, 78]]);
    expect(ids('ma.missing4').map((it) => it.shown)).toEqual([[5, 6, 7, null], [20, null, 40, 50], [null, 300, 400, 500], [348, 349, null, 351]]);
    expect([...ids('ma.add2i'), ...ids('ma.sub2i'), ...ids('ma.mul2i')].map((it) => it.show)).toEqual(['13 + 6', '18 + 7', '19 − 6', '25 − 7', '3 × 4', '8 × 9']);
  });

  test('every W3 task practises first (a spoken task: Jugnu models the answer), except the story and its questions', () => {
    const b = runtime('coach.G5.A', 'ur');
    for (const t of w3Of(b).filter((x) => !/story/.test(x.id))) {
      expect([t.id, t.practice.length > 0]).toEqual([t.id, true]);
      for (const p of t.practice) {
        if (t.response === 'record') expect([t.id, p.model.length, p.model.every((c) => c.text && c.audio)]).toEqual([t.id, 2, true]);
        else expect([t.id, !!(p.feedback && p.feedback.correct)]).toEqual([t.id, true]);
      }
    }
  });

  test('a v3 / extra src names the bank path that holds the item', () => {
    const extraBank = extra;
    const resolve = (src) => {
      const [bank, path0] = src.replace(/ \(.*$/, '').split(':');
      const root = bank === 'v3' ? v3 : extraBank;
      const parts = path0.replace(/\[(\d+)\]/g, '.$1').split('.');
      let o = root;
      for (let i = 0; i < parts.length && o != null; i += 1) {
        let k = parts[i];
        while (!(k in o) && i + 1 < parts.length) { i += 1; k = `${k}.${parts[i]}`; }
        o = o[k];
      }
      return o;
    };
    const b = runtime('coach.G3.A', 'ur');
    let n = 0;
    for (const t of w3Of(b).filter((x) => !/story/.test(x.id))) {
      for (const it of [...t.items, ...t.practice]) {
        if (!/^(v3|extra):/.test(it.src)) continue;
        const at = resolve(it.src);
        const want = at && typeof at === 'object' ? (at.answer ?? at.letter ?? at.item ?? at.numeral) : at;
        const got = t.response === 'tap' || /^ma\./.test(t.id) ? it.target : it.show;
        expect([t.id, it.id, String(got)]).toEqual([t.id, it.id, String(want)]);
        n += 1;
      }
    }
    expect(n).toBeGreaterThan(40);
  });

  // RULING W3-12 (passage layout): each sentence starts a new line on every served passage, app and paper alike, so
  // every variant's words carry line = the sentence they sit in, counted on that variant's own printed text.
  test('every passage variant, UR and EN: line = sentence number; print_lines one per sentence; reach and stop follow', () => {
    const END = /[.!?۔؟]["”’)]*$/u;
    const extraUr2 = extra.reading.ur.story2;
    for (const form of COACH_FORMS) for (const lang of ['ur', 'en']) {
      const b = runtime(form, lang);
      const story = b.tasks.find((x) => x.id === `${lang}.story_w3`);
      const comp = b.tasks.find((x) => x.id === `${lang}.story_comp_w3`);
      for (const v of [story, ...(story.variants || [])]) {
        let n = 1;
        const want = v.items.map((w, i) => { const at = n; if (END.test(w.text) && i < v.items.length - 1) n += 1; return at; });
        expect([v.id, v.items.map((w) => w.line)]).toEqual([v.id, want]);
        expect(v.passage.lines.map((l) => [l.n, l.from, l.to])).toEqual(
          [...new Set(want)].map((k) => [k, want.indexOf(k), want.lastIndexOf(k)]));
        expect(v.passage.print_lines).toHaveLength(n);
        expect(v.passage.print_lines.join(' ')).toBe(v.passage.text.replace(/\s+/g, ' ').trim());
        // EGRA's early stop is on the first printed line, now the first sentence
        expect(v.stop.first_line_n).toBe(want.filter((k) => k === 1).length);
      }
      if (lang === 'ur') {
        const sel = story.variants.find((v) => v.id === 'select2024');
        expect(Math.max(...sel.items.map((w) => w.line))).toBe(8);
        // SELECT's questions keep the instrument's markers: a question needs the sentence holding its marker word
        const q = comp.variants.find((v) => v.id === 'select2024').items;
        expect(q.map((x) => x.needs_line)).toEqual(extraUr2.questions.map((x) => sel.items[x.after_marker - 1].line));
        expect(q.map((x) => x.needs_line)).toEqual([1, 3, 4, 5, 8]);
      }
    }
  });

  // RULING W3-12 4c: a mental sum is not read aloud; the child says its answer.
  test('mental + − × and fluency: the chip says "Say the answer" / «جواب بتائیں»; other one-at-a-time tasks keep theirs', () => {
    for (const form of COACH_FORMS) {
      for (const [lang, word] of [['en', 'Say the answer'], ['ur', 'جواب بتائیں']]) {
        const b = runtime(form, lang);
        for (const id of ['ma.add2i', 'ma.sub2i', 'ma.mul2i', 'ma.fluency1m']) expect([id, b.tasks.find((t) => t.id === id).chip]).toEqual([id, word]);
        for (const id of ['ma.number_id8', `${lang}.words4`]) expect([id, b.tasks.find((t) => t.id === id).chip]).toEqual([id, undefined]);
      }
    }
  });

  test('switch OFF: the battery the server serves has no RDF W3 key and no W3 task (today\'s battery)', () => {
    for (const form of COACH_FORMS) for (const lang of ['ur', 'en']) {
      const b = runtime(form, lang);
      const off = applySwitches(b, {});
      // OFF is exactly what the builder makes without the W3 items: today's battery
      expect(off).toEqual(applySwitches(runtimeBattery(buildSaBank({ v3, extra }), form, lang), {}));
      expect(off.rdf_auto).toBeUndefined();
      expect(off.tasks.some((t) => t.w3)).toBe(false);
      expect(off.lines.coach_will_instruct).toBeUndefined();
      const on = applySwitches(b, { rdfW3Forms: true });
      expect(on.rdf_auto).toEqual(b.rdf_auto);
      expect(w3Of(on).length).toBe(w3Of(b).length);
    }
  });

  test('game forms carry no W3 tasks', () => {
    for (const form of ['game.G1', 'game.G23', 'game.G45']) {
      const b = runtime(form, 'ur');
      expect(b.rdf_auto).toBeUndefined();
      expect(w3Of(b).length).toBe(0);
    }
  });

  test('the committed files are what the builder makes with the W3 items', () => {
    const files = JSON.parse(JSON.stringify(splitSaBankWithRuntime(buildSaBank({ v3, extra, w3 }))));
    for (const form of COACH_FORMS) for (const lang of ['ur', 'en']) expect(runtime(form, lang)).toEqual(files[`sa/sa.${form}.${lang}.json`]);
  });
});
