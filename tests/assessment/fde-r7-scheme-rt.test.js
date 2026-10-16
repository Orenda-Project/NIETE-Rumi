/**
 * Red-team probes (R3-6 "never a lump chip"). Pure chain:
 * normaliseScheme → renderMarkingScheme. A bare chip is a chip whose text is
 * only a number (Latin or Urdu-Indic), i.e. a row with marks but no points.
 */
const path = require('path');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const P = Patterns.get('fde_g5_2027');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
// A whole layout (header, scope, sections) as the engine lays it, so the scheme renders.
const layoutOf = (subject) => applyLayout({ unseen: { subjective: {} } }, P.subjects[subject], { kind: 'fde' }, { now: '2026-10-20T07:12:00.000Z' }).examJson._layout;
const clone = (v) => JSON.parse(JSON.stringify(v));
const SCIENCE = require('./fixtures/fde/r7-science-full1.exam.json');
// A locally generated Science paper (gen-local corpus) whose Q2(b) parts came back as plain strings.
const STRING_PARTS = require(process.env.RT_STRING_PARTS_FIXTURE || path.join(__dirname, 'fixtures/fde/rt-r7s-science-string-parts.exam.json'));

const html = (exam) => { const o = R.renderMarkingScheme({ examJson: exam, grade: 5, subject: exam._layout.subject, allowShort: true }); return typeof o === 'string' ? o : (o.html || o.body); };
const bareChips = (h) => [...String(h).matchAll(/<span class="chip">(?:<span class="num">)?([0-9۰-۹.]+)(?:<\/span>)?<\/span>/g)].length;
const Q2B = 'Logical Reasoning';

describe('rt-r7s: situation parts the model wrote as strings', () => {
  test('recorded gen-local science paper: parts are strings, parent answer is lettered', () => {
    const item = Object.values(STRING_PARTS.unseen.subjective).flat().find((q) => q.slot === 'science.B.Q2b');
    expect(typeof item.questions[0]).toBe('string');
    expect(item.answer).toMatch(/a\)/);
  });
  test('string parts with a lettered parent answer are filled, not left as bare 2.5 chips (BLOCK probe)', () => {
    const { examJson, shortfall } = normaliseScheme(STRING_PARTS);
    expect(shortfall).toEqual([]);
    const h = html(examJson);
    expect(bareChips(h)).toBe(0);
    expect((examJson._layout.scheme_shortfall || []).length).toBeGreaterThan(0);
  });
  test('synthetic: one string part on the recorded sandbox paper', () => {
    const exam = clone(SCIENCE);
    const item = exam.unseen.subjective[Q2B][2];
    item.questions = item.questions.map((s) => s.question); // strings, as the model sometimes writes them
    item.answer = 'a) The clip and the pin. b) Wood is not magnetic. c) The field acts at a distance.';
    const { examJson, shortfall } = normaliseScheme(exam);
    expect(shortfall).toEqual([]);
    expect(bareChips(html(examJson))).toBe(0);
  });
});

describe('rt-r7s: whole written items', () => {
  const wordProblem = (over) => ({ slot: 'maths.B.Q2', question: 'A shop sold goods worth Rs. 500,000 and spent Rs. 172,250. How much is left?', answer: 'Rs. 327,750', marks: 5, blooms: 'Apply', scheme: { points: [] }, ...over });
  const mathsPaper = (q) => ({ _layout: layoutOf('maths'), unseen: { subjective: { 'Word Problems': [q] } } });
  test('an array answer on a written item does not leave a bare chip (finding probe)', () => {
    const { examJson, shortfall } = normaliseScheme(mathsPaper(wordProblem({ answer: ['Rs. 327,750', '327750'] })));
    const bare = bareChips(html(examJson));
    expect(bare + shortfall.length).toBeGreaterThan(0); // documents today's behaviour: bare chip, no shortfall
    expect(shortfall).toEqual([]);
    expect(bare).toBe(1);
  });
  test('a removed written item is filled and listed (renderer must count live rows only)', () => {
    const { examJson } = normaliseScheme(mathsPaper(wordProblem({ removed: true })));
    expect(examJson._layout.scheme_shortfall).toEqual([{ slot: 'maths.B.Q2', item: 0, part: null, filled_by: 'code' }]);
    expect(bareChips(html(examJson))).toBe(0);
  });
  test('junk points (non-numeric marks) on a written item end as one A point, not junk chips', () => {
    const { examJson } = normaliseScheme(mathsPaper(wordProblem({ scheme: { points: [{ text: 'x', marks: 'abc', kind: 'A' }, { text: 'y', marks: null }] } })));
    const q = examJson.unseen.subjective['Word Problems'][0];
    expect(q.scheme.points).toEqual([{ kind: 'A', marks: 5, text: 'Rs. 327,750' }]);
    expect(html(examJson)).not.toMatch(/NaN/);
  });
  test('marks given as a string still fill with a number', () => {
    const { examJson } = normaliseScheme(mathsPaper(wordProblem({ marks: '5' })));
    expect(examJson.unseen.subjective['Word Problems'][0].scheme.points[0].marks).toBe(5);
  });
  test('a 300-code-point answer is capped in the point text and the row still renders', () => {
    const long = 'x'.repeat(300);
    const { examJson } = normaliseScheme(mathsPaper(wordProblem({ answer: long })));
    expect(examJson.unseen.subjective['Word Problems'][0].scheme.points[0].text.length).toBeLessThanOrEqual(240);
  });
});

describe('rt-r7s: objective rows and idempotence', () => {
  test('English Q1(b) rewrite rows keep a bare «1» chip (objective; out of R3-6 scope — finding)', () => {
    const exam = { _layout: layoutOf('english'), unseen: { objective: { rewrite: [{ slot: 'english.A.Q1b', question: 'The baby slept. (Change into present continuous)', answer: 'The baby is sleeping.', marks: 1, blooms: 'Apply' }] } } };
    const { examJson } = normaliseScheme(exam);
    expect(bareChips(html(examJson))).toBe(1);
    expect('scheme_shortfall' in examJson._layout).toBe(false);
  });
  test('a second pass changes only key order (semantically idempotent)', () => {
    const once = normaliseScheme(SCIENCE).examJson;
    const twice = normaliseScheme(once).examJson;
    expect(twice).toEqual(once);
  });
  test('a plain paper (no _layout) is untouched and gains no key', () => {
    const plain = { questions: [{ question: 'Q', answer: 'A', marks: 2 }] };
    expect(normaliseScheme(plain).examJson).toEqual(plain);
  });
});
