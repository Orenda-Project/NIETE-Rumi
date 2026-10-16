/**
 * red-team-pr3a: adversarial probes on the board-pattern paper fixes (PR #2344, head f84424429).
 * Pure chain: applyLayout → normaliseScheme → mathsCheck → renderPaper / renderMarkingScheme.
 * Fictional fixtures only. A `test.failing` is a documented finding, not a pass.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const { mathsCheck } = require('../../bot/shared/services/assessment/maths-check');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const englishMcqs = require('./fixtures/fde/r5w2-mcq-english.json');
const urduFull = require('./fixtures/fde/urdu.json');
const scienceFull = require('./fixtures/fde/science.json');
const mathsFull = require('./fixtures/fde/maths.json');

const P = Patterns.get('fde_g5_2027').subjects;
const NOW = '2026-10-20T07:12:00.000Z';
const FDE = { kind: 'fde', chapters: null, pages: null };
const clone = (o) => JSON.parse(JSON.stringify(o));
const visible = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const FORBIDDEN = ['⚠', 'needs review', 'needs fluent', 'filler', 'اسی طرح', 'Islamabad Model School', 'مسودہ', 'undefined', 'NaN', '[object Object]'];

function stripLetters(scheme, slot) {
  const row = new RegExp(`<div class="strip" data-row="${slot.replace(/\./g, '\\.')}">(.*?)</div>`).exec(scheme);
  if (!row) throw new Error(`no answer strip for ${slot}`);
  const cells = row[1].split('<span class="sc">').slice(1).map((c) => c.replace(/<[^>]+>/g, ''));
  return cells.map((c) => c.replace(/[·،]\s*$/, '').trim().split(/\s+/).pop());
}
function paperOptions(paper) {
  return [...paper.matchAll(/<div class="opts[^"]*">([\s\S]*?)<\/div>/g)].map((m) => [...m[1].matchAll(/<span class="opt"><span class="ol">[^<]*<\/span> ([\s\S]*?)<\/span>/g)].map((c) => c[1].replace(/<[^>]+>/g, '').trim()));
}
function keyIndex(q) {
  const a = String(q.answer).trim();
  const latin = /^\(?([a-dA-D])\)?(?:[.):\s]|$)/.exec(a);
  if (latin) return latin[1].toLowerCase().charCodeAt(0) - 97;
  const urdu = /^\(?(الف|ب|ج|د)\)?/.exec(a);
  if (urdu) return ['الف', 'ب', 'ج', 'د'].indexOf(urdu[1]);
  return q.options.map(R.bareOption).indexOf(R.bareOption(a));
}
function tally(list) { const out = {}; list.forEach((k) => { out[k] = (out[k] || 0) + 1; }); return out; }

function chain(raw, subject, scope = FDE) {
  const laid = applyLayout(raw, P[subject], scope, { now: NOW });
  const ns = normaliseScheme(laid.examJson);
  const mc = mathsCheck(ns.examJson, { subject });
  const exam = mc.examJson;
  const paper = R.renderPaper({ examJson: exam, grade: 5, subject, allowShort: true });
  const scheme = R.renderMarkingScheme({ examJson: exam, grade: 5, subject, allowShort: true });
  return { laid, ns, mc, exam, paper, scheme };
}

// ── maths-check: a key that shows its working ─────────────────────────────

function mathsExam(items) {
  return { unseen: { subjective: { 'Word Problems': items.map(([question, answer]) => ({ slot: 'maths.B.Q2', question, answer, blooms: 'Apply' })) } } };
}
function checked(items) {
  const run = chain(mathsExam(items), 'maths');
  const out = Object.values(run.exam.unseen.subjective).flat();
  return items.map(([question]) => out.find((q) => q.question === question));
}
let wpN = 0;
const WP = (answer) => [`Shop problem ${(wpN += 1)}: how much in all?`, answer];

describe('maths-check: a word-problem key that shows its working', () => {
  it('corrects a wrong stated result (positive control) and keeps the whole key otherwise', () => {
    const [q] = checked([WP('7 × 8 = 54')]);
    expect(q.scheme.checked).toBe('replaced');
    expect(q.answer).toBe('7 × 8 = 56');
  });

  it('52.8 ÷ 1.2 = 44 is ok, not replaced (a float compare would not say 44)', () => {
    const [q, r] = checked([
      ['A rope of 52.8 m is cut into pieces of 1.2 m. How many pieces?', '52.8 ÷ 1.2 = 44'],
      ['A tin of 64.55 kg is shared equally among 5 families. How much each?', '64.55 ÷ 5 = 12.91 kg'],
    ]);
    expect([q.scheme.checked, q.answer]).toEqual(['ok', '52.8 ÷ 1.2 = 44']);
    expect([r.scheme.checked, r.answer]).toEqual(['ok', '64.55 ÷ 5 = 12.91 kg']);
  });

  // RT BLOCK #2344 item 1: a conversion whose stage before the result is a bare number is "corrected"
  // («4 × 250 = 1000 = 1 kg» → «1000 kg», note "key corrected by code; the model wrote 1").
  it('never rewrites a key across a unit change, even when the stage before carries no unit', () => {
    const keys = ['3 × 1000 = 3000 = 3 km', '5 × 12 = 60 = 1 hour', '60 × 24 = 1440 = 1 day', '4 × 250 = 1000 = 1 kg', '2 × 500 = 1000 = 1 litre'];
    const out = checked(keys.map(WP));
    out.forEach((q, i) => {
      expect([keys[i], q.answer]).toEqual([keys[i], keys[i]]);
      expect([keys[i], q.scheme.checked]).not.toEqual([keys[i], 'replaced']);
    });
  });

  it('still corrects a wrong result after a stage with an operator, with or without a unit', () => {
    const [a, b, c] = checked([WP('85000 - 24567 = Rs. 60,333'), WP('7 × 8 = 54 pencils'), WP('5 3/4 - 2 1/4 = 3 2/4 = 3 1/2 litres')]);
    expect([a.scheme.checked, a.answer]).toEqual(['replaced', '85000 - 24567 = Rs. 60,433']);
    expect([b.scheme.checked, b.answer]).toEqual(['replaced', '7 × 8 = 56 pencils']);
    expect([c.scheme.checked, c.answer]).toEqual(['ok', '5 3/4 - 2 1/4 = 3 2/4 = 3 1/2 litres']);
  });

  it('keeps a correct key whose units match on both sides', () => {
    const keys = ['Rs. 2,500 × 3 = Rs. 7,500', '1.5 km × 4 = 6 km', '4 cm × 5 cm = 20 cm²', '750 g + 250 g = 1000 g = 1 kg', '3 × 120 = 360 girls.'];
    const out = checked(keys.map(WP));
    out.forEach((q, i) => {
      expect([keys[i], q.answer]).toEqual([keys[i], keys[i]]);
      expect([keys[i], q.scheme.checked]).not.toEqual([keys[i], 'replaced']);
    });
  });

  it('rounding: a recurring value shown rounded is ok; a terminating one is left unchecked; a wrong rounding is replaced', () => {
    const [a, b, c] = checked([WP('22 ÷ 7 = 3.14'), WP('1 ÷ 8 = 0.13'), WP('1 ÷ 8 = 0.12')]);
    expect(a.scheme.checked).toBe('ok');
    expect([b.scheme.checked, b.answer]).toEqual([null, '1 ÷ 8 = 0.13']);
    // A wrong rounding of a terminating value: replaced with the exact value (0.125).
    expect([c.scheme.checked, c.answer]).toEqual(['replaced', '1 ÷ 8 = 0.125']);
  });

  it('leaves alone what it cannot read as one sum (percent, "of", time, ratio, negative, lakh grouping)', () => {
    const keys = ['15% of 200 = 30', '2/5 of 15000 = 6000', '2:30 + 1:45 = 4:15', '3 : 5 = 6 : 10', '5 − 8 = −3', '1,20,000 ÷ 4 = 30,000', 'Total: 120.75 + 60.50 = 181.25'];
    const out = checked(keys.map(WP));
    out.forEach((q, i) => {
      expect([keys[i], q.answer]).toEqual([keys[i], keys[i]]);
      expect([keys[i], q.scheme.checked]).not.toEqual([keys[i], 'replaced']);
    });
  });

  it('a plain paper (no _layout) is never touched, whatever the key says', () => {
    const raw = mathsExam([WP('7 × 8 = 54')]);
    const { examJson } = mathsCheck(raw, { subject: 'maths' });
    const q = examJson.unseen.subjective['Word Problems'][0];
    expect(q.answer).toBe('7 × 8 = 54');
    expect(q.scheme.checked).toBe(null);
  });

  it('a non-maths pattern paper is never checked (subject from the option or from _layout)', () => {
    const raw = clone(scienceFull);
    const q3 = Object.values(raw.unseen.subjective).flat().find((q) => q.slot === 'science.C.Q3a');
    q3.answer = '2 + 2 = 5';
    const laid = applyLayout(raw, P.science, FDE, { now: NOW }).examJson;
    for (const opts of [{ subject: 'science' }, {}]) {
      const out = mathsCheck(laid, opts).examJson;
      const q = Object.values(out.unseen.subjective).flat().find((x) => x.slot === 'science.C.Q3a' && x.question === q3.question);
      expect(q.answer).toBe('2 + 2 = 5');
    }
  });
});

// ── layout: the keys spread over the letters ──────────────────────────────

function mcqExam(slot, type, make) {
  return { unseen: { objective: { MCQs: Array.from({ length: 20 }, (_, i) => ({ slot, ...make(i), marks: 1, blooms: 'Remember' })) } } };
}

describe('layout: key spreading', () => {
  // FINDING: True/False and Yes/No pairs are turned round ("a) False b) True").
  it('keeps True/False (and درست/غلط) options in their order', () => {
    const en = applyLayout(mcqExam('english.A.Q1a', 'MCQs', (i) => ({ question: `Statement ${i + 1} is a sentence.`, options: ['True', 'False'], answer: 'a' })), P.english, FDE, { now: NOW }).examJson;
    en.unseen.objective.MCQs.forEach((q) => expect(q.options).toEqual(['True', 'False']));
    const ur = applyLayout(mcqExam('urdu.A.Q1', 'MCQs', (i) => ({ question: `جملہ ${i + 1} درست ہے؟`, options: ['درست', 'غلط'], answer: 'الف' })), P.urdu, FDE, { now: NOW }).examJson;
    ur.unseen.objective.MCQs.forEach((q) => expect(q.options).toEqual(['درست', 'غلط']));
  });

  it('keeps ordered numeric options with a known unit in order', () => {
    const en = applyLayout(mcqExam('english.A.Q1a', 'MCQs', (i) => ({ question: `How long is ribbon ${i + 1}?`, options: ['a) 10 cm', 'b) 20 cm', 'c) 30 cm', 'd) 40 cm'], answer: 'b) 20 cm' })), P.english, FDE, { now: NOW }).examJson;
    en.unseen.objective.MCQs.forEach((q) => expect(q.options).toEqual(['a) 10 cm', 'b) 20 cm', 'c) 30 cm', 'd) 40 cm']));
  });

  // FINDING: "degrees" (and any Urdu unit word) is not a unit the order check knows, so an in-order set is turned.
  it('keeps ordered numeric options in order when the unit word is "degrees" or Urdu', () => {
    const en = applyLayout(mcqExam('english.A.Q1a', 'MCQs', (i) => ({ question: `Angle ${i + 1}?`, options: ['a) 0 degrees', 'b) 90 degrees', 'c) 180 degrees', 'd) 360 degrees'], answer: 'b) 90 degrees' })), P.english, FDE, { now: NOW }).examJson;
    en.unseen.objective.MCQs.forEach((q) => expect(q.options).toEqual(['a) 0 degrees', 'b) 90 degrees', 'c) 180 degrees', 'd) 360 degrees']));
    const ur = applyLayout(mcqExam('social_studies.A.Q1', 'MCQs', (i) => ({ question: `زاویہ ${i + 1}؟`, options: ['0 درجے', '90 درجے', '180 درجے', '360 درجے'], answer: 'ب' })), P.social_studies, FDE, { now: NOW }).examJson;
    ur.unseen.objective.MCQs.forEach((q) => expect(q.options).toEqual(['0 درجے', '90 درجے', '180 درجے', '360 درجے']));
  });

  it('a second applyLayout pass (the engine re-lays after a filter drop) keeps every key text, stays spread and doubles no label', () => {
    const once = applyLayout(englishMcqs, P.english, FDE, { now: NOW }).examJson;
    const twice = applyLayout(once, P.english, FDE, { now: NOW }).examJson;
    const before = new Map(englishMcqs.unseen.objective.MCQs.map((q) => [q.question, q]));
    for (const q of twice.unseen.objective.MCQs) {
      const old = before.get(q.question);
      expect(R.bareOption(q.options[keyIndex(q)])).toBe(R.bareOption(old.options[keyIndex(old)]));
      q.options.forEach((o) => expect(o).not.toMatch(/^[a-d]\) [a-d]\) /));
    }
    const scheme = R.renderMarkingScheme({ examJson: twice, grade: 5, subject: 'english', allowShort: true });
    expect(Math.max(...Object.values(tally(stripLetters(scheme, 'english.A.Q1a'))))).toBeLessThanOrEqual(7);
  });

  it('bare-letter keys on unlabelled options: the paper option at the strip letter is the original key text (en, incl. "B.")', () => {
    const raw = clone(englishMcqs);
    raw.unseen.objective.MCQs.forEach((q, i) => {
      const k = keyIndex(q);
      q.options = q.options.map(R.bareOption);
      q.answer = i % 2 ? `${'ABCD'[k]}.` : 'abcd'[k];
    });
    const originalKey = new Map(raw.unseen.objective.MCQs.map((q) => [q.question, q.options[keyIndex(q)]]));
    const laid = applyLayout(raw, P.english, FDE, { now: NOW }).examJson;
    const paper = R.renderPaper({ examJson: laid, grade: 5, subject: 'english', allowShort: true });
    const scheme = R.renderMarkingScheme({ examJson: laid, grade: 5, subject: 'english', allowShort: true });
    const letters = stripLetters(scheme, 'english.A.Q1a');
    const cells = paperOptions(paper);
    expect(cells).toHaveLength(20);
    laid.unseen.objective.MCQs.forEach((q, i) => {
      expect([q.question, cells[i]['abcd'.indexOf(letters[i])]]).toEqual([q.question, originalKey.get(q.question)]);
    });
    expect(Math.max(...Object.values(tally(letters)))).toBeLessThanOrEqual(7);
  });

  it('bare Urdu-letter keys on unlabelled options: paper and strip agree (ur)', () => {
    const words = ['گلاب', 'چنبیلی', 'سورج مکھی', 'کنول'];
    const raw = mcqExam('social_studies.A.Q1', 'MCQs', (i) => ({ question: `پھول ${i + 1} کون سا ہے؟`, options: words.map((w) => `${w} ${i + 1}`), answer: 'ب' }));
    const laid = applyLayout(raw, P.social_studies, FDE, { now: NOW }).examJson;
    const paper = R.renderPaper({ examJson: laid, grade: 5, subject: 'social_studies', allowShort: true });
    const scheme = R.renderMarkingScheme({ examJson: laid, grade: 5, subject: 'social_studies', allowShort: true });
    const letters = stripLetters(scheme, 'social_studies.A.Q1');
    const cells = paperOptions(paper);
    expect(cells).toHaveLength(20);
    laid.unseen.objective.MCQs.forEach((q, i) => {
      const at = ['الف', 'ب', 'ج', 'د'].indexOf(letters[i]);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(cells[i][at].replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).toBe(`چنبیلی ${i + 1}`);
    });
    expect(Math.max(...Object.values(tally(letters)))).toBeLessThanOrEqual(7);
  });
});

// ── renderer ──────────────────────────────────────────────────────────────

describe('renderer', () => {
  it('prints no `words` on a slot that does not name print_words (Science Q3a), whatever the model sends', () => {
    const raw = clone(scienceFull);
    const q3 = Object.values(raw.unseen.subjective).flat().find((q) => q.slot === 'science.C.Q3a');
    q3.words = ['LEAKEDKEYONE', 'LEAKEDKEYTWO'];
    const { paper } = chain(raw, 'science');
    expect(visible(paper)).not.toContain('LEAKEDKEY');
  });

  // FINDING (fix-r5-paper idea 170307): other free model fields still print wherever they appear.
  it('prints no `topics` on a slot whose pattern data does not name them (Science Q3a)', () => {
    const raw = clone(scienceFull);
    const q3 = Object.values(raw.unseen.subjective).flat().find((q) => q.slot === 'science.C.Q3a');
    q3.topics = ['STRAYTOPICONE'];
    const { paper } = chain(raw, 'science');
    expect(visible(paper)).not.toContain('STRAYTOPICONE');
  });

  it('an old _layout (no print_words on its slots, the shared legend) still prints the Urdu word lists and the subject legend', () => {
    const fresh = chain(urduFull, 'urdu');
    expect((fresh.paper.match(/class="word-line"/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(visible(fresh.scheme)).not.toContain('چوک');
    const old = clone(fresh.exam);
    old._layout.sections.forEach((sec) => sec.slots.forEach((s) => { delete s.print_words; }));
    old._layout.legend = clone(P.maths.legend);
    delete old._layout.legend.subject;
    const paper = R.renderPaper({ examJson: old, grade: 5, subject: 'urdu', allowShort: true });
    const scheme = R.renderMarkingScheme({ examJson: old, grade: 5, subject: 'urdu', allowShort: true });
    expect((paper.match(/class="word-line"/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(visible(scheme)).not.toContain('چوک');
  });

  it('the answer strip reads every key shape (en: d, D., (c), a), "b text"; ur: (ج), د۔, ب)', () => {
    const en = { unseen: { objective: { MCQs: [
      { slot: 'english.A.Q1a', question: 'One?', options: ['red', 'green', 'blue', 'None of these'], answer: 'd' },
      { slot: 'english.A.Q1a', question: 'Two?', options: ['red', 'green', 'blue', 'None of these'], answer: 'D.' },
      { slot: 'english.A.Q1a', question: 'Three?', options: ['red', 'green', 'blue', 'None of these'], answer: '(c)' },
      { slot: 'english.A.Q1a', question: 'Four?', options: ['red', 'green', 'blue', 'None of these'], answer: 'a)' },
      { slot: 'english.A.Q1a', question: 'Five?', options: ['red', 'green', 'blue', 'None of these'], answer: 'b green' },
      { slot: 'english.A.Q1a', question: 'Six?', options: ['a dog', 'a cat', 'a cow', 'None of these'], answer: 'a cat' },
    ] } } };
    const laid = applyLayout(en, P.english, FDE, { now: NOW }).examJson;
    const scheme = R.renderMarkingScheme({ examJson: laid, grade: 5, subject: 'english', allowShort: true });
    expect(stripLetters(scheme, 'english.A.Q1a')).toEqual(['d', 'd', 'c', 'a', 'b', 'b']);
    const ur = { unseen: { objective: { MCQs: [
      { slot: 'social_studies.A.Q1', question: 'ایک؟', options: ['سرخ', 'سبز', 'نیلا', 'ان میں سے کوئی نہیں'], answer: '(ج)' },
      { slot: 'social_studies.A.Q1', question: 'دو؟', options: ['سرخ', 'سبز', 'نیلا', 'ان میں سے کوئی نہیں'], answer: 'د۔' },
      { slot: 'social_studies.A.Q1', question: 'تین؟', options: ['سرخ', 'سبز', 'نیلا', 'ان میں سے کوئی نہیں'], answer: 'ب' },
      { slot: 'social_studies.A.Q1', question: 'چار؟', options: ['بکری', 'بارش', 'نیلا', 'ان میں سے کوئی نہیں'], answer: 'بارش' },
    ] } } };
    const laidUr = applyLayout(ur, P.social_studies, FDE, { now: NOW }).examJson;
    const schemeUr = R.renderMarkingScheme({ examJson: laidUr, grade: 5, subject: 'social_studies', allowShort: true });
    expect(stripLetters(schemeUr, 'social_studies.A.Q1')).toEqual(['ج', 'د', 'ب', 'ب']);
  });

  it('Urdu: a Latin token with digits is an LTR isolate with Western digits; a plain number takes Urdu digits; 8x5 is a sum', () => {
    const raw = { unseen: { subjective: { 'Short Questions': [{ slot: 'social_studies.C.Q5', question: 'K-2 دنیا کی دوسری بلند چوٹی ہے، 8611 میٹر اونچی۔ COVID-19 کے دوران 8x5 کمرے بند رہے۔', answer: 'K-2', marks: 4 }] } } };
    const { paper } = chain(raw, 'social_studies');
    expect(paper).toContain('<bdi class="ltr" dir="ltr">K-2</bdi>');
    expect(paper).toContain('<bdi class="ltr" dir="ltr">COVID-19</bdi>');
    expect(paper).toContain('۸۶۱۱');
    expect(paper).not.toMatch(/<bdi[^>]*>8x5<\/bdi>/);
  });

  // FINDING: "5kg" written without a space is read as a Latin token and keeps Western digits on an Urdu paper.
  it('Urdu: a number glued to a unit (5kg, 10cm) still takes Urdu digits', () => {
    const raw = { unseen: { subjective: { 'Short Questions': [{ slot: 'social_studies.C.Q5', question: 'ایک تھیلے میں 5kg چاول اور 10cm لمبی رسی ہے۔', answer: '5', marks: 4 }] } } };
    const { paper } = chain(raw, 'social_studies');
    expect(paper).not.toMatch(/<bdi[^>]*>5kg<\/bdi>/);
    expect(paper).toContain('۵');
  });

  it('a sub-question the model lettered prints one letter; a word that starts with a letter is not cut', () => {
    const raw = { unseen: { subjective: { 'Logical Reasoning': [{
      slot: 'science.B.Q2b', main_question: 'Read the situation.', question: 'A class sprayed glitter water to stand for germs.',
      questions: [{ question: 'a) Why did glitter spread?' }, { question: '(B) What did soap do?' }, { question: 'About how many children washed?' }],
      answer: 'a) By touch. b) Removed it. c) Half of them.',
    }] } } };
    const { paper, scheme } = chain(raw, 'science');
    const v = visible(paper);
    expect(v).toContain('a) Why did glitter spread?');
    expect(v).toContain('b) What did soap do?');
    expect(v).toContain('c) About how many children washed?');
    expect(v).not.toContain('a) a)');
    expect(v).not.toContain('c) bout how many');
    const s = visible(scheme);
    expect(s).toContain('By touch.');
    expect(s).toContain('Removed it.');
    expect(s).toContain('Half of them.');
  });

  // FINDING: a situation whose parent answer carries no a)/b)/c) letters reaches the scheme as three empty rows.
  it('situation rows: a parent answer with no letters still reaches the scheme somewhere', () => {
    const raw = { unseen: { subjective: { 'Logical Reasoning': [{
      slot: 'science.B.Q2b', main_question: 'Read the situation.', question: 'A class sprayed glitter water to stand for germs.',
      questions: [{ question: 'Why did glitter spread?' }, { question: 'What did soap do?' }, { question: 'Suggest one habit.' }],
      answer: 'Glitter spreads by touch; soap removes most of it; washing hands breaks the chain.',
    }] } } };
    const { scheme } = chain(raw, 'science');
    expect(visible(scheme)).toContain('Glitter spreads by touch');
  });

  it('the legend keys exactly the chips the scheme prints; Maths keeps its two working lines, Science does not', () => {
    const sci = chain(scienceFull, 'science');
    const chips = new Set([...sci.scheme.matchAll(/<span class="chip">([MAUKL])/g)].map((m) => m[1]));
    const legend = /<div class="box legend">([\s\S]*?)<\/div><\/div>|<div class="box legend">([\s\S]*?)<\/ul>/.exec(sci.scheme);
    const keyed = new Set([...(legend[1] || legend[2]).matchAll(/\b([MAUKL]) = /g)].map((m) => m[1]));
    expect(chips.size).toBeGreaterThan(0);
    expect([...keyed].sort()).toEqual([...chips].sort());
    expect(visible(sci.scheme)).not.toContain('arithmetic slip');
    const maths = chain(mathsFull, 'maths');
    expect(visible(maths.scheme)).toContain('arithmetic slip');
    expect(visible(maths.scheme)).toContain('M = method');
    expect(visible(maths.scheme)).toContain('p.113');
    expect(visible(maths.scheme)).not.toContain('p.115');
  });

  it('the Urdu legend key line never puts · beside a digit and carries no Western 115', () => {
    const { scheme } = chain(urduFull, 'urdu');
    const v = visible(scheme);
    expect(v).toContain('ص ۱۱۳');
    expect(v).not.toContain('115');
    expect(v).not.toContain('۱۱۵');
    expect(v).not.toMatch(/[۰-۹]\s*·|·\s*[۰-۹]/);
  });

  it('rendered paper and scheme carry no debug or forbidden string (maths, science, urdu)', () => {
    for (const subject of ['maths', 'science', 'urdu']) {
      const { paper, scheme } = chain({ maths: mathsFull, science: scienceFull, urdu: urduFull }[subject], subject);
      for (const bad of FORBIDDEN) {
        expect([subject, bad, visible(paper).includes(bad)]).toEqual([subject, bad, false]);
        expect([subject, bad, visible(scheme).includes(bad)]).toEqual([subject, bad, false]);
      }
    }
  });

  it('scheme lines: 200 code points print whole, 300 are capped at 240', () => {
    const raw = clone(scienceFull);
    const q3 = Object.values(raw.unseen.subjective).flat().find((q) => q.slot === 'science.C.Q3a');
    const line200 = 'Accept any answer that names the energy source and the direction of the arrows in a food chain and uses the words producer and consumer correctly with one example each. '.repeat(2).slice(0, 200);
    const line300 = `${line200}${line200}`.slice(0, 300);
    q3.scheme = q3.scheme || {};
    q3.scheme.accept = [line200, line300];
    q3.scheme.common_error = line300;
    const { exam, scheme } = chain(raw, 'science');
    const out = Object.values(exam.unseen.subjective).flat().find((q) => q.slot === 'science.C.Q3a' && q.question === q3.question);
    expect([...line200].length).toBe(200);
    expect(out.scheme.accept[0]).toBe(line200);
    expect([...out.scheme.accept[1]].length).toBeLessThanOrEqual(240);
    expect([...out.scheme.common_error].length).toBeLessThanOrEqual(240);
    expect(visible(scheme)).toContain(line200.trim());
  });
});

// ── layout: scope words and picks ─────────────────────────────────────────

describe('layout: scope and picks', () => {
  it('one chapter (even listed twice) reads singular, in both languages', () => {
    const m = applyLayout(mathsFull, P.maths, { kind: 'chapters', chapters: [3, 3], pages: null }, { now: NOW }).examJson._layout.scope;
    expect(m.covers_en).toBe('Covers Unit 3; every section set from this unit.');
    expect(m.covers_en).not.toContain('Units');
    const u = applyLayout(urduFull, P.urdu, { kind: 'chapters', chapters: [5], pages: null }, { now: NOW }).examJson._layout.scope;
    expect(u.covers_ur).toContain('سبق 5');
    expect(u.covers_ur).toContain('اسی سبق');
    expect(u.covers_ur).not.toContain('انہی');
    expect(u.covers_ur).not.toContain('اسی طرح');
    const two = applyLayout(urduFull, P.urdu, { kind: 'chapters', chapters: [4, 5], pages: null }, { now: NOW }).examJson._layout.scope;
    expect(two.covers_en).toMatch(/^Covers Lessons 4–5;/);
  });

  it('picks keep the first `need` valid words in the order written; spares are dropped silently; too few is a shortfall', () => {
    const raw = { unseen: { subjective: { 'Comprehension Passage': [{
      slot: 'english.B.Q2',
      passage: 'The farmer walked to the market with a dog. The dog ran and the farmer laughed.',
      parts: [
        { key: 'questions', questions: [{ question: 'Who walked?', answer: 'The farmer' }, { question: 'Who ran?', answer: 'The dog' }, { question: 'Where?', answer: 'To the market' }, { question: 'Who laughed?', answer: 'The farmer' }, { question: 'With what?', answer: 'A dog' }] },
        { key: 'do_as_directed', questions: [{ question: 'Part of speech of "walked"?', answer: 'verb' }, { question: 'Change to present: walked', answer: 'walks' }, { question: 'Fill: The ___ ran.', answer: 'dog' }, { question: 'True/false: the farmer cried.', answer: 'false' }] },
        { key: 'pick', pick: { Nouns: ['farmer', 'castle', 'market', 'dog', 'laughed'], Verbs: ['walked', 'ran'] } },
      ],
    }] } } };
    const laid = applyLayout(raw, P.english, FDE, { now: NOW });
    const ns = normaliseScheme(laid.examJson);
    const q = Object.values(ns.examJson.unseen.subjective).flat().find((x) => x.slot === 'english.B.Q2');
    const pick = q.parts.find((p) => p.key === 'pick').pick;
    const need = P.english.sections.flatMap((s) => s.slots).find((s) => s.slot === 'english.B.Q2').parts_spec.find((p) => p.key === 'pick').pick;
    expect(pick.Nouns).toEqual(['farmer', 'market', 'dog', 'laughed'].slice(0, need.Nouns));
    expect(ns.shortfall.find((s) => s.kind === 'Nouns')).toBeUndefined();
    expect(pick.Verbs).toEqual(['walked', 'ran'].slice(0, need.Verbs));
    if (need.Verbs > 2) expect(ns.shortfall.find((s) => s.kind === 'Verbs')).toEqual(expect.objectContaining({ have: 2, need: need.Verbs }));
  });
});
