// Validator for item-bank.v1.json (CONTRACT §2; v2 additions CONTRACT §19, bead bd-s1oo0.46.3). Run: node --test item-bank.schema.test.mjs  (ITEM_BANK_PATH=… to point elsewhere)
// Zero dependencies. Exits 1 on the first failing check group, printing every failure in it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
// Bank path: ITEM_BANK_PATH env, else item-bank.v1.json beside this file, else the bot's committed copy.
import { existsSync } from 'node:fs';
const candidates = [process.env.ITEM_BANK_PATH, join(here, 'item-bank.v1.json'), join(here, '../../../bot/shared/data/child-test/item-bank.v1.json')];
const path = candidates.find((p) => p && existsSync(p));
const bank = JSON.parse(readFileSync(path, 'utf8'));

const GRADES = ['3', '5'];
const FORMS = ['A', 'B'];
const PUNCT = /[.,!?;:"'()\-–—،؛؟۔]/u;
const ARABIC_LOOKALIKES = /[يكهى]/u; // ي ك ه ى — Urdu uses ی ک ہ
const LATIN = /[A-Za-z]/;
const MAY_UR_TOKENS = 60;
const MAY_EN_TOKENS = 60;

const forms = () => GRADES.flatMap((g) => FORMS.map((f) => [g, f, bank.grades[g].forms[f]]));
const urduStrings = [];
const allStrings = [];
function walk(x, inUrdu, keyPath = '') {
  if (typeof x === 'string') {
    allStrings.push([keyPath, x]);
    if (inUrdu) urduStrings.push([keyPath, x]);
  } else if (Array.isArray(x)) x.forEach((v, i) => walk(v, inUrdu, `${keyPath}[${i}]`));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) walk(v, inUrdu || k === 'urdu' || k.endsWith('_ur'), `${keyPath}.${k}`);
}
walk(bank, false);

function calc(expr) {
  const m = expr.match(/^(\d+) ([+\-×÷]) (\d+)$/);
  assert.ok(m, `bad arithmetic prompt "${expr}"`);
  const [a, op, b] = [Number(m[1]), m[2], Number(m[3])];
  if (op === '÷') assert.equal(a % b, 0, `${expr} not exact`);
  return { '+': a + b, '-': a - b, '×': a * b, '÷': a / b }[op];
}
function wordsOf(text, lang) {
  return lang === 'urdu'
    ? text.replace(/[،؛؟۔]/gu, ' ').split(/\s+/).filter(Boolean)
    : text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g);
}

test('top level', () => {
  assert.equal(bank.version, 'child-test-items-v2');
  for (const b of ['urdu', 'english', 'maths']) {
    assert.ok(bank.cue[b]?.start && bank.cue[b]?.stop, `cue.${b}`);
    for (const alt of [...(bank.cue[b].alt_start || []), ...(bank.cue[b].alt_stop || [])]) {
      assert.ok(alt.trim().split(/\s+/).length >= 2, `cue.${b} alt "${alt}" must be at least two words (one word occurs in stories and answers)`);
      if (bank.cue[b].stt_language === 'en') assert.ok(!/[\u0600-\u06FF]/.test(alt), `cue.${b} alt "${alt}" must be English: the block's STT is en`);
    }
    const SECTIONS = { urdu: ['questions', 'first_sounds', 'nonwords'], english: ['questions', 'nonwords'], maths: ['numbers', 'quick_sums', 'word_problem'] }[b];
    for (const k of SECTIONS) {
      const c = bank.cue[b][k];
      assert.ok(typeof c === 'string' && c.trim() && [...c].length <= 60, `cue.${b}.${k} is a short line`);
      assert.ok(b === 'english' ? /^[A-Za-z ,.'!?-]+$/.test(c) : /[\u0600-\u06FF]/.test(c) && !/[A-Za-z]/.test(c), `cue.${b}.${k} language`);
    }
  }
  assert.deepEqual(Object.keys(bank.grades).sort(), GRADES);
  for (const g of GRADES) assert.deepEqual(Object.keys(bank.grades[g].forms).sort(), FORMS);
});

test('ids are unique and follow the prefix scheme', () => {
  const ids = [];
  (function collect(x) {
    if (Array.isArray(x)) x.forEach(collect);
    else if (x && typeof x === 'object') {
      if (typeof x.id === 'string') ids.push(x.id);
      Object.values(x).forEach(collect);
    }
  })(bank.grades);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dup, [], `duplicate ids: ${dup}`);
  for (const id of ids) assert.match(id, /^[uem][35][AB]-(story|q\d|fs\d|nw\d|n\d|qs\d+|w\d|wp|oc\d|os\d|owp\d)$/, id);
});

test('stories: tokens, counts, lengths, lines', () => {
  for (const [g, f, F] of forms()) {
    for (const lang of ['urdu', 'english']) {
      const s = F[lang].story;
      const tag = `${g}${f} ${lang}`;
      assert.ok(s.id && s.title && s.text && s.source, `${tag} story fields`);
      assert.ok(Array.isArray(s.tokens) && s.tokens.length > 0, `${tag} tokens`);
      for (const t of s.tokens) {
        assert.ok(!PUNCT.test(t.replace(/^[A-Za-z]+'[a-z]+$/, 'x')), `${tag} punctuation in token "${t}"`);
        assert.ok(t.trim() === t && t.length > 0, `${tag} empty/space token`);
      }
      assert.equal(s.word_count, s.tokens.length, `${tag} word_count`);
      assert.deepEqual(wordsOf(s.text, lang), s.tokens, `${tag} tokens must be the words of text in order`);
      if (g === '5') assert.ok(s.word_count >= 130, `${tag} Grade 5 story must be >= 130 words (got ${s.word_count})`);
      if (g === '3' && f === 'A') assert.equal(s.word_count, lang === 'urdu' ? MAY_UR_TOKENS : MAY_EN_TOKENS, `${tag} May passage length`);
      if (f === 'A') assert.match(s.source, lang === 'urdu' ? /^may2026-orf_urd/ : /^may2026-orf_eng/, `${tag} Form A source`);
      if (g === '5' && f === 'A') assert.equal(s.may_part_word_count, 60, `${tag} May part`);
      // lines cover tokens contiguously
      let next = 0;
      for (const l of s.lines) { assert.equal(l.from, next, `${tag} line ${l.n} start`); next = l.to + 1; }
      assert.equal(next, s.tokens.length, `${tag} lines cover all tokens`);
    }
  }
});

test('Form A Grade 5 story starts with the Grade 3 May passage', () => {
  for (const lang of ['urdu', 'english']) {
    const g3 = bank.grades['3'].forms.A[lang].story.tokens;
    const g5 = bank.grades['5'].forms.A[lang].story.tokens;
    assert.deepEqual(g5.slice(0, g3.length), g3, lang);
  }
});

test('questions', () => {
  for (const [g, f, F] of forms()) {
    for (const [lang, n] of [['urdu', 3], ['english', 3]]) {
      const qs = F[lang].questions;
      const tag = `${g}${f} ${lang}`;
      assert.equal(qs.length, n, `${tag} question count`);
      for (const q of qs) {
        assert.ok(['literal', 'inferential'].includes(q.type), `${q.id} type`);
        assert.ok(q.prompt && q.rubric, `${q.id} prompt/rubric`);
        assert.ok(Array.isArray(q.accept) && q.accept.length >= 1, `${q.id} accept`);
        assert.ok(Array.isArray(q.reject) && q.reject.length >= 1, `${q.id} reject`);
        assert.ok(Number.isInteger(q.needs_line) && q.needs_line >= 1 && q.needs_line <= F[lang].story.lines.length, `${q.id} needs_line`);
        const overlap = q.accept.filter((a) => q.reject.includes(a));
        assert.deepEqual(overlap, [], `${q.id} accept/reject overlap`);
      }
      const lines = qs.map((q) => q.needs_line);
      assert.deepEqual([...lines].sort((a, b) => a - b), lines, `${tag} questions in story order`);
      if (g === '5' && f === 'A') {
        // questions on the May part are the May literal items; the rest are inferential, on the continuation
        assert.equal(qs[0].type, 'literal', `${tag} q1 literal`);
        const mayLines = F[lang].story.lines.filter((l) => l.to < 60).length;
        assert.ok(qs[0].needs_line <= mayLines, `${tag} q1 inside the May part`);
        const later = qs.filter((q) => q.needs_line > mayLines);
        assert.ok(later.length >= 1, `${tag} at least one question on the continuation`);
        for (const q of qs) {
          if (q.needs_line <= mayLines) {
            assert.equal(q.type, 'literal', `${q.id} literal on the May part`);
            assert.match(q.source, /^rdcomp_lit\d_/, `${q.id} a May item`);
          } else assert.equal(q.type, 'inferential', `${q.id} inferential on the continuation`);
        }
      }
      // English (v2): three questions, the third from the May rdcomp_*_eng set inside the Grade 3 passage
      if (lang === 'english' && f === 'A') {
        const may = qs.filter((q) => /^rdcomp_(lit|inf)\d_eng$/.test(q.source));
        assert.ok(may.length >= (g === '3' ? 3 : 2), `${tag} May English questions (${may.length})`);
        const g3Lines = bank.grades['3'].forms.A.english.story.lines.length;
        for (const q of may) assert.ok(q.needs_line <= g3Lines, `${q.id} inside the Grade 3 passage`);
      }
    }
    // Form B mirrors Form A's question types
    if (f === 'B') for (const lang of ['urdu', 'english']) {
      assert.deepEqual(F[lang].questions.map((q) => q.type), bank.grades[g].forms.A[lang].questions.map((q) => q.type), `${g}B ${lang} types match A`);
    }
  }
});

test('first sounds, nonwords, fallback', () => {
  for (const [g, f, F] of forms()) {
    const tag = `${g}${f}`;
    const fs = F.urdu.first_sounds;
    assert.equal(fs.length, 5, `${tag} first_sounds`);
    for (const x of fs) assert.ok(x.word.startsWith(x.sound), `${x.id} word starts with its sound`);
    assert.equal(new Set(fs.map((x) => x.sound)).size, 5, `${tag} distinct first sounds`);
    assert.equal(F.urdu.nonwords.length, 5, `${tag} urdu nonwords`);
    assert.equal(F.english.nonwords.length, 8, `${tag} english nonwords`);
    for (const lang of ['urdu', 'english']) {
      for (const nw of F[lang].nonwords) {
        assert.ok(nw.text && Array.isArray(nw.sounds) && nw.sounds.length >= 2, `${nw.id}`);
        const spelled = nw.sounds.map((u) => u.replace('_e', '')).join('') + (nw.sounds.some((u) => u.endsWith('_e')) ? 'e' : '');
        assert.equal(spelled, nw.text, `${nw.id} sounds spell the word`);
        assert.ok(!F[lang].fallback.words.includes(nw.text), `${nw.id} is a fallback word`);
        assert.ok(!F[lang].story.tokens.map((t) => t.toLowerCase()).includes(nw.text), `${nw.id} appears in the story`);
      }
      const fb = F[lang].fallback;
      assert.equal(fb.letters.length, 10, `${tag} ${lang} letters`);
      assert.equal(fb.words.length, 10, `${tag} ${lang} words`);
      assert.equal(new Set(fb.words).size, 10, `${tag} ${lang} distinct words`);
    }
  }
});

test('maths', () => {
  for (const [g, f, F] of forms()) {
    const m = F.maths;
    const tag = `${g}${f} maths`;
    assert.equal(m.strip_code, `G${g}-${f}`, `${tag} strip_code`);
    assert.equal(m.numbers.length, 8, `${tag} numbers`);
    const max = g === '3' ? 999 : 99999;
    for (const n of m.numbers) {
      assert.ok(Number.isInteger(n.value) && n.value >= 0 && n.value <= max, `${n.id} range`);
      assert.ok(n.say_ur && n.say_en, `${n.id} say`);
      assert.ok(!LATIN.test(n.say_ur), `${n.id} say_ur latin`);
    }
    const vals = m.numbers.map((n) => n.value);
    assert.ok(vals.some((v) => v >= 11 && v <= 19), `${tag} has a teen`);
    assert.ok(vals.some((v) => v % 10 === 0 && v >= 20 && v <= 90), `${tag} has a decade`);
    assert.ok(Math.max(...vals) >= (g === '3' ? 100 : 10000), `${tag} reaches ${g === '3' ? '3' : '5'} digits`);
    assert.ok(m.quick_sums.length >= 40, `${tag} >= 40 quick sums`);
    const ops = new Set();
    for (const q of m.quick_sums) {
      assert.ok(Number.isInteger(q.answer), `${q.id} numeric answer`);
      assert.equal(calc(q.prompt), q.answer, `${q.id} answer`);
      assert.ok(q.answer >= 0, `${q.id} non-negative`);
      ops.add(q.prompt.split(' ')[1]);
      if (g === '3') {
        const [a, op, b] = q.prompt.split(' ');
        assert.ok(['+', '-'].includes(op), `${q.id} G3 only + and -`);
        if (op === '+') assert.ok(Number(a) <= 9 && Number(b) <= 9, `${q.id} single-digit addends`);
        else assert.ok(Number(b) <= 9 && q.answer <= 9, `${q.id} subtraction fact`);
      }
    }
    assert.deepEqual([...ops].sort(), g === '3' ? ['+', '-'] : ['+', '-', '×', '÷'], `${tag} operations`);
    assert.equal(new Set(m.quick_sums.map((q) => q.prompt)).size, m.quick_sums.length, `${tag} quick sums unique`);
    assert.equal(m.written.length, 4, `${tag} written`);
    for (const w of m.written) {
      assert.ok(Number.isInteger(w.answer), `${w.id} numeric`);
      assert.equal(calc(w.prompt), w.answer, `${w.id} answer`);
      const [a, op, b] = w.prompt.split(' ').map((x, i) => (i === 1 ? x : Number(x)));
      if (g === '3') {
        assert.ok(a >= 10 && a <= 99 && b >= 10 && b <= 99, `${w.id} 2-digit`);
        const regroup = op === '+' ? (a % 10) + (b % 10) >= 10 : (a % 10) < (b % 10);
        assert.ok(regroup, `${w.id} has one regrouping`);
      }
    }
    if (g === '5') {
      const ops5 = m.written.map((w) => w.prompt.split(' ')[1]);
      assert.ok(ops5.includes('×') && ops5.includes('÷'), `${tag} written × and ÷`);
      assert.ok(m.written.some((w) => /^\d{3} [+\-] \d{3}$/.test(w.prompt)), `${tag} written 3-digit`);
    }
    const wp = m.word_problem;
    assert.ok(wp.id && wp.prompt_ur && wp.prompt_en, `${tag} word problem`);
    assert.ok(Number.isInteger(wp.answer), `${tag} word problem numeric answer`);
  }
});

test('Urdu text sanity: Urdu letters (not Arabic look-alikes), no stray Latin, no doubled spaces', () => {
  const bad = [];
  const CONTENT = new Set(['text', 'title', 'tokens', 'prompt', 'accept', 'reject', 'word', 'sound', 'say', 'letters', 'words',
    'start', 'stop', 'alt_start', 'alt_stop', 'say_ur', 'prompt_ur', 'greet', 'go_on', 'questions_intro', 'fallback', 'names', 'sounds', 'questions', 'first_sounds', 'nonwords', 'numbers', 'quick_sums', 'word_problem']);
  for (const [k, s] of urduStrings) {
    const last = k.replace(/\[\d+\]/g, '').split('.').pop();
    if (!CONTENT.has(last) || k.includes('.cue.english')) continue;
    if (ARABIC_LOOKALIKES.test(s)) bad.push(`${k}: Arabic look-alike in "${s}"`);
    if (LATIN.test(s)) bad.push(`${k}: Latin in "${s}"`);
  }
  for (const [k, s] of allStrings) {
    if (/ {2}/.test(s)) bad.push(`${k}: doubled space`);
    if (s !== s.normalize('NFC')) bad.push(`${k}: not NFC`);
  }
  assert.deepEqual(bad, []);
});

// ------------------------------------------------------------------ v2 (CONTRACT §19, COACH_JOURNEY_V2 §3.1)
const URDU_SCRIPT = /[؀-ۿ]/;
// Words said to the child are the same for every child: no gendered address, no gendered first person.
const UR_GENDERED = /(^|\s)(بیٹا|بیٹی|بیٹے|بچی|بچہ|لڑکی|لڑکا|بھائی|بہن)(?=$|[\s،۔؟!])|ں (گا|گی|گے)(?=$|[\s،۔؟!])/u;   // a future ending carries the gender of whoever does it
const EN_GENDERED = /\b(he|she|him|her|his|boy|girl|son|beta)\b/i;
const sameLine = (a, b) => String(a).replace(/[.؟?۔!]+$/u, '').trim() === String(b).replace(/[.؟?۔!]+$/u, '').trim();

test('v2 script lines: every form, exact cue phrases, the child\'s language, gender-neutral', () => {
  const KEYS = {
    urdu: ['greet', 'start', 'go_on', 'stop', 'questions_intro', 'fallback'],
    english: ['start', 'go_on', 'stop', 'questions_intro', 'fallback'],
    maths: ['start', 'compare', 'sum', 'next', 'wp_intro', 'stop'],
  };
  for (const [g, f, F] of forms()) {
    for (const block of ['urdu', 'english', 'maths']) {
      const sc = block === 'maths' ? F.maths.oral && F.maths.oral.script : F[block].script;
      const tag = `${g}${f} ${block}`;
      assert.ok(sc, `${tag} script`);
      assert.deepEqual(Object.keys(sc).sort(), [...KEYS[block]].sort(), `${tag} script keys`);
      const cue = bank.cue[block];
      const starts = [cue.start, ...(cue.alt_start || [])];
      const stops = [cue.stop, ...(cue.alt_stop || [])];
      assert.ok(starts.some((c) => sameLine(sc.start, c) || String(sc.start).trim().endsWith(c)), `${tag} start ends with a start cue`);
      assert.ok(stops.some((c) => sameLine(sc.stop, c)), `${tag} stop is a stop cue`);
      if (block === 'maths') {
        assert.ok(sameLine(sc.compare, cue.compare), `${tag} compare == cue.maths.compare`);
        assert.ok(sameLine(sc.sum, cue.sum), `${tag} sum == cue.maths.sum`);
        assert.ok(sameLine(sc.next, cue.next), `${tag} next == cue.maths.next`);
        assert.ok(sameLine(sc.wp_intro, cue.word_problems), `${tag} wp_intro == cue.maths.word_problems`);
      } else {
        assert.ok(sameLine(sc.questions_intro, cue.questions), `${tag} questions_intro == cue.${block}.questions`);
      }
      for (const [k, line] of Object.entries(sc)) {
        assert.ok(typeof line === 'string' && line.trim() && [...line].length <= 160, `${tag} ${k} is a short line`);
        assert.ok(!/ {2}/.test(line) && line === line.normalize('NFC'), `${tag} ${k} spacing/NFC`);
        if (block === 'english') {
          assert.ok(!URDU_SCRIPT.test(line), `${tag} ${k} is English`);
          assert.ok(!EN_GENDERED.test(line), `${tag} ${k} gender-neutral: "${line}"`);
        } else {
          assert.ok(URDU_SCRIPT.test(line) && !LATIN.test(line) && !ARABIC_LOOKALIKES.test(line), `${tag} ${k} is Urdu`);
          assert.ok(!UR_GENDERED.test(line), `${tag} ${k} gender-neutral: "${line}"`);
          assert.ok(!/[0-9]/.test(line), `${tag} ${k} Urdu prose uses Urdu digits`);
        }
      }
    }
  }
});

// The May 2026 EGMA set (CONTRACT §19 table), Set A = Form A.
const MAY_ORAL = {
  compare: [[11, 16], [93, 77], [625, 638], [3826, 2863]],
  sums: { 3: ['14 + 1', '19 - 6', '92 - 41', '85 + 37'], 5: ['92 - 41', '85 + 37', '8 × 9', '72 ÷ 6'] },
  wp: { 3: [6, 12], 5: [21, 5] },
};

test('v2 oral maths: 4 compare, 4 sums, 2 word problems; Set A is the May instrument, Set B parallel and not equated', () => {
  for (const [g, f, F] of forms()) {
    const o = F.maths.oral;
    const tag = `${g}${f} maths.oral`;
    assert.ok(o, tag);
    assert.equal(o.compare.length, 4, `${tag} compare`);
    assert.equal(o.sums.length, 4, `${tag} sums`);
    assert.equal(o.word_problems.length, 2, `${tag} word problems`);
    assert.deepEqual(o.compare.map((c) => c.label), ['A', 'B', 'C', 'D'], `${tag} compare labels`);
    assert.deepEqual(o.sums.map((s) => s.label), ['1', '2', '3', '4'], `${tag} sum labels`);
    for (const c of o.compare) {
      assert.ok(Number.isInteger(c.a) && Number.isInteger(c.b) && c.a !== c.b, `${c.id} two different numbers`);
      assert.equal(c.answer, Math.max(c.a, c.b), `${c.id} answer is the bigger number`);
    }
    for (const s of o.sums) {
      assert.ok(Number.isInteger(s.answer), `${s.id} numeric`);
      assert.equal(calc(s.prompt), s.answer, `${s.id} answer`);
    }
    for (const w of o.word_problems) {
      assert.ok(w.prompt_ur && w.prompt_en && Number.isInteger(w.answer) && w.answer >= 0, `${w.id}`);
      assert.ok(!/[0-9A-Za-z]/.test(w.prompt_ur) && /[۰-۹]/.test(w.prompt_ur), `${w.id} Urdu prose with Urdu digits`);
      assert.ok(!ARABIC_LOOKALIKES.test(w.prompt_ur), `${w.id} Urdu letters`);
      const enNums = (w.prompt_en.match(/\d+/g) || []).map(Number).sort((a, b) => a - b);
      const urNums = (w.prompt_ur.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).match(/\d+/g) || []).map(Number).sort((a, b) => a - b);
      assert.deepEqual(urNums, enNums, `${w.id} the Urdu and English say the same numbers`);
    }
    const ids = [...o.compare, ...o.sums, ...o.word_problems].map((x) => x.id);
    for (const id of ids) assert.ok(id.startsWith(`m${g}${f}-o`), `${id} prefix`);
    if (f === 'A') {
      assert.equal(o.equated, true, `${tag} Set A is the instrument`);
      assert.deepEqual(o.compare.map((c) => [c.a, c.b]), MAY_ORAL.compare, `${tag} May compare pairs`);
      assert.deepEqual(o.sums.map((s) => s.prompt), MAY_ORAL.sums[g], `${tag} May sums`);
      assert.deepEqual(o.word_problems.map((w) => w.answer), MAY_ORAL.wp[g], `${tag} May word problems`);
      for (const x of [...o.compare, ...o.sums, ...o.word_problems]) assert.match(x.source, /^may2026-egma:/, `${x.id} source`);
    } else {
      assert.equal(o.equated, false, `${tag} Set B is not equated`);
      const A = bank.grades[g].forms.A.maths.oral;
      // parallel: same shape (digits per number, operation per sum, answer positions), different numbers
      o.compare.forEach((c, i) => {
        const a = A.compare[i];
        assert.deepEqual([String(c.a).length, String(c.b).length], [String(a.a).length, String(a.b).length], `${c.id} same number lengths`);
        assert.equal(c.answer === c.a, a.answer === a.a, `${c.id} bigger number on the same side`);
        assert.notDeepEqual([c.a, c.b], [a.a, a.b], `${c.id} different numbers`);
      });
      o.sums.forEach((s, i) => {
        assert.equal(s.prompt.split(' ')[1], A.sums[i].prompt.split(' ')[1], `${s.id} same operation`);
        assert.notEqual(s.prompt, A.sums[i].prompt, `${s.id} different numbers`);
      });
      o.word_problems.forEach((w, i) => assert.notEqual(w.prompt_en, A.word_problems[i].prompt_en, `${w.id} different context`));
    }
  }
});
