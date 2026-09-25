/**
 * bd-oak77.34 — UNWORDED_Q, measured.
 *
 * `unworded(q)` in the vendored lint is the gate that fails a "question" that tells the pupil
 * nothing to DO — the expert's ringed "|B|, B⁻¹: B = [ … ]". It was implemented but had NO test in
 * this repo, so its catch rate was unmeasured. This suite is that measurement: two inline
 * corpora, a KNOWN-BAD list that must every one be flagged and a KNOWN-GOOD list that must every
 * one pass, in English and Urdu, plus the two lint() wiring sites (question lists and the
 * worked/faded example prompt).
 *
 * THE CORPORA ARE SMALL AND HAND-WRITTEN. They are a floor, not a population estimate: every
 * entry is either the shape the brief itself names, or a defect class found while writing this
 * suite (marked `found:`). A 100% here means "no known case fails", not "catches 100% in the wild".
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { lint, unworded } = require(path.join(VENDOR, 'lint_lp.js'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(FIXTURE, 'utf8');
const load = () => JSON.parse(raw);

// ── KNOWN BAD: no frame, a bare heading, or a pointer ─────────────────────────
const BAD = [
  '',
  '   ',
  '|B|, B⁻¹: B = [ … ]',                         // the expert's ringed item (brief §0)
  '$|B|$, $B^{-1}$',                             // same, in LaTeX
  '$A^{-1}$ (p.68)',                             // the page-citation pointer (brief §0)
  'Matrix multiplication',
  'Photosynthesis',
  "Newton's second law of motion",
  'Exercise 1.2, Q3',
  'Types of chemical bonds',
  'Order of a matrix',                           // found: `order` is a command word, "Order of" is a heading
  'Use of articles',                             // found: same class, `use`
  'Balance of forces on a body',                 // found: same class, `balance`
  // Urdu headings. `found:` each contains a command token as a SUBSTRING of an ordinary word —
  // کسر (fraction) ⊃ کس, مرکب (compound) ⊃ کب, اعداد و شمار (statistics) ⊃ شمار,
  // بنیادیں (foundations) ⊃ دیں, عکس (image) ⊃ کس.
  'کسر کی اقسام',
  'مرکب اور آمیزہ',
  'اعداد و شمار',
  'جمہوریت کی بنیادیں',
  'عکس کی خصوصیات',
  'نیوٹن کا دوسرا قانون',
];

// ── KNOWN GOOD: correctly-worded questions a gate must never fail ─────────────
const GOOD = [
  'Find $AB$ when $A = \\begin{bmatrix} 1 & 0 \\\\ 2 & 3 \\end{bmatrix}$ and $B = \\begin{bmatrix} 5 & 1 \\\\ 0 & 2 \\end{bmatrix}$.',
  'If $B = \\begin{bmatrix} 2 & 1 \\\\ 1 & 1 \\end{bmatrix}$, find $B^{-1}$.',
  'Which statement about matrix multiplication is true?',
  'A hypothesis must be:',                       // colon-terminated MCQ stem (lint comment)
  'Do two blocks of different mass take the same time to fall? Check using $t = \\sqrt{2h/g}$.',
  'Explain, in one sentence, why the product is not defined.',
  'Fill in the blank with a word that keeps this hypothesis tentative.',
  'Order these numbers from smallest to largest: 3, 1, 2.',   // `order` as a real imperative
  'Use the graph to estimate the speed at 4 s.',
  'Classify these animals as vertebrates or invertebrates.',  // found: `classify` was missing
  'Translate the sentence into Urdu.',                        // found: `translate` was missing
  'Rewrite the sentence in the passive voice.',               // found: `rewrite` was missing
  'Construct a triangle $ABC$ with $AB = 5$ cm.',              // found: `construct` was missing
  'Make a table of your results.',                            // found: `make` was missing
  'Summarise the paragraph in two lines.',                    // found: `summarise` was missing
  'Discuss with your partner how a plant makes its food.',
  'درج ذیل جملوں کو مکمل کریں۔',
  'پانی کے تین استعمال لکھیں۔',
  'پودے کو دھوپ کیوں ضروری ہے؟',
  'کسر ۳/۴ کو اعشاریہ میں تبدیل کریں۔',            // contains کسر, framed by کریں
  'اس مرکب کا نام بتائیں۔',
  '…کی ایک مثال دیں',                               // the 2026-09-02 fleet re-run case
  'دیا گیا جملہ پڑھیں اور فعل پر دائرہ لگائیں۔',
  'کس نے پاکستان کا پہلا آئین بنایا؟',
  'دو اعداد کا حاصل ضرب شمار کریں۔',
];

describe('bd-oak77.34 — unworded(): catch rate on the known-bad corpus', () => {
  test.each(BAD.map((q) => [q]))('flags %j', (q) => {
    expect(unworded(q)).toEqual(expect.any(String));
  });

  test('catch rate is 100% of the known-bad corpus', () => {
    const missed = BAD.filter((q) => !unworded(q));
    expect(missed).toEqual([]);
  });
});

describe('bd-oak77.34 — unworded(): false-positive rate on the known-good corpus', () => {
  test.each(GOOD.map((q) => [q]))('passes %j', (q) => {
    expect(unworded(q)).toBeNull();
  });

  test('false-positive rate is 0% of the known-good corpus', () => {
    const wrongly = GOOD.filter((q) => unworded(q)).map((q) => [q, unworded(q)]);
    expect(wrongly).toEqual([]);
  });
});

describe('bd-oak77.34 — lint() wires UNWORDED_Q at both sites', () => {
  const unwordedFails = (doc) => lint(doc).fails.filter((f) => /UNWORDED_Q/.test(String(f)));

  test('the clean fixture raises no UNWORDED_Q (a fair baseline)', () => {
    expect(unwordedFails(load())).toEqual([]);
  });

  test('an unworded exit-ticket question fails the lint', () => {
    const d = load();
    const s = d.sections.find((x) => Array.isArray(x.exit_ticket) && x.exit_ticket.length);
    s.exit_ticket[0].q = '$|B|$, $B^{-1}$';
    const fails = unwordedFails(d);
    expect(fails).toHaveLength(1);
    expect(String(fails[0])).toMatch(/exit ticket/);
  });

  test('an unworded worked_example prompt fails the lint', () => {
    const d = load();
    const walk = (bs) => (bs || []).flatMap((b) => [b, ...walk(b.left), ...walk(b.right)]);
    const we = d.sections.flatMap((s) => walk(s.blocks)).find((b) => b.type === 'worked_example');
    we.prompt = '$A^{-1}$ (p.68)';
    const fails = unwordedFails(d);
    expect(fails).toHaveLength(1);
    expect(String(fails[0])).toMatch(/worked_example prompt/);
  });
});
