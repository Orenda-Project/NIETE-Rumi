/**
 * bd-uu4lr — the WhatsApp message that arrives BEFORE the PDF gets a shape.
 *
 * Operator, 2026-09-11: *"the text message preceding the LP was not formatted as we discussed"*,
 * and on 2026-09-12, of the format proposed back: *"item 1 is correct"*.
 *
 * WHAT IS WRONG TODAY. `one_screen` is authored as one unbroken 150-260 word paragraph — the
 * base fixture's is 181 words in a single block — and `buildBody` in `lp612-serving.service.js`
 * pushes it onto the phone verbatim. On a phone that is a grey wall of text arriving ahead of
 * the document it is supposed to introduce. The only gate on it is a word count
 * (`lint_lp.js` rule 12), which cannot see structure at all.
 *
 * THE SHAPE. Same beats, same word budget, one paragraph per beat, each led by a WhatsApp bold
 * cue. The beats are the ones the v2 schema already documents and the brief already teaches —
 * objective, prerequisite, worked example, practice, misconception, exit — and their ORDER is
 * load-bearing and unchanged: it front-loads practice because the end of a structured lesson is
 * what gets cut (MDPI 16:5:699). This is a formatting change, not a content change.
 *
 * WHY SINGLE ASTERISKS, AND WHY THERE IS NO BIDI PROBLEM. Two facts settle the Urdu question
 * the bead asked to check:
 *
 *   1. `one_screen` NEVER reaches the PDF. `lib/template.js` has no reference to it, and
 *      `visual_check.js:328` already skips it for exactly this reason — *"the WhatsApp MESSAGE
 *      BODY, not the page"*. So `lib/rich.js`'s LRI/PDI isolate pass, which wraps numeric
 *      ranges when the document renders RTL, never touches this field. There is no collision
 *      between a bold asterisk and a bidi isolate because the two never meet.
 *   2. Which makes the markup dialect a real trap in the other direction. The PDF path uses
 *      `**double**` asterisks (`rich()`'s `bold()`); WhatsApp uses `*single*` and prints a
 *      double asterisk LITERALLY. An author carrying the page habit into this field puts
 *      `**Objective**` in front of a teacher. Same class of defect as the KaTeX one already
 *      guarded at `visual_check.js:328`, so it is guarded the same way: named and failed.
 *
 * A cue is checked as `*...*` at the head of a block and nothing more — no word list. The cue
 * is teacher-facing prose in the lesson's own language, so an Urdu overlay writes Urdu cues,
 * and any rule that matched English labels would fire on every correct Urdu body.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { lint } = require(path.join(VENDOR, 'lint_lp.js'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(FIXTURE, 'utf8');
const load = () => JSON.parse(raw);

const BRIEF_DIR = VENDOR;
const BRIEFS = [
  'brief_author_v3.md',
  'brief_author_v3_flash_sci.md',
  'brief_author_v3_flash_prose.md',
  'brief_author_v3_flash_maths.md',
];
const briefSrc = (f) => fs.readFileSync(path.join(BRIEF_DIR, f), 'utf8');

const run = (doc) => lint(doc, FIXTURE);
const codes = (res) => res.fails.map((f) => f.split(':')[0]);
const hasFail = (res, code) => res.fails.some((f) => f.startsWith(`${code}:`));

/** A correctly shaped body: six blocks, each opening with a single-asterisk cue, 150-260 words. */
const GOOD = [
  "*Today's lesson* Multiplying two 2×2 matrices, from page 24 of the Grade 9 mathematics book. By the end the class can multiply two 2×2 matrices and state the order of the product.",
  '*First, a warm-up* Work out three times two plus four times five, which is twenty six. That single line is the whole rule in miniature, so start there and do not skip it.',
  '*Model it on the board* Worked example one on page 24, in front of the class. Check the orders first, then say each address out loud — row one, column one — before you write the entry down.',
  '*Then they practise* Guided practice with two of the four entries blanked, then three independent items tagged support, core and extension. Close with the four-mark board question on the conclusion card.',
  '*Watch for this mistake* The predictable error is multiplying the matching positions, exactly as the class did for addition. Name it out loud before it happens rather than correcting it afterwards.',
  '*Before they leave* A one-item exit ticket. Homework is four tagged items, two of them multiple choice, and every one of them is answered in full in the reference block on the support page.',
].join('\n\n');

/**
 * The defect as it shipped: the same beats, the same words, in one unbroken block — which is
 * exactly what the fixture held until this bead reformatted it. Built here rather than read from
 * the fixture so the case survives the fixture being fixed.
 */
const WALL = GOOD.split('\n\n')
  .map((b) => b.replace(/^\*[^*]+\*\s*/, ''))
  .join(' ');

const withOneScreen = (text) => {
  const d = load();
  d.one_screen = text;
  return d;
};

describe('one_screen carries a shape, not just a word count', () => {
  test('the base fixture is clean once it is formatted', () => {
    const res = run(withOneScreen(GOOD));
    expect(codes(res)).not.toContain('ONESCREEN');
    expect(codes(res)).not.toContain('ONESCREEN_FORMAT');
    expect(codes(res)).not.toContain('ONESCREEN_BOLD');
  });

  test('one unbroken paragraph FAILS — this is the defect being fixed', () => {
    // In budget, correct content, no structure at all.
    const res = run(withOneScreen(WALL));
    expect(hasFail(res, 'ONESCREEN_FORMAT')).toBe(true);
  });

  test('the shipped fixture is itself correctly shaped', () => {
    // The reformat is the deliverable, not just the rule that guards it — every other lp612
    // suite lints this fixture, so a wall here reddens twelve of them.
    const res = run(load());
    expect(hasFail(res, 'ONESCREEN_FORMAT')).toBe(false);
    expect(hasFail(res, 'ONESCREEN_BOLD')).toBe(false);
  });

  test('the failure message says what to do, not just what is wrong', () => {
    const msg = run(withOneScreen(WALL)).fails.find((f) => f.startsWith('ONESCREEN_FORMAT:'));
    expect(msg).toMatch(/blank line/i);
    expect(msg).toMatch(/\*/);
  });

  test('too few blocks FAILS — three beats is not the lesson', () => {
    const short = GOOD.split('\n\n').slice(0, 3).join('\n\n');
    expect(hasFail(run(withOneScreen(short)), 'ONESCREEN_FORMAT')).toBe(true);
  });

  test('a block with no cue FAILS, even when every other block has one', () => {
    const blocks = GOOD.split('\n\n');
    blocks[3] = blocks[3].replace(/^\*[^*]+\*\s*/, '');
    expect(hasFail(run(withOneScreen(blocks.join('\n\n'))), 'ONESCREEN_FORMAT')).toBe(true);
  });

  test('the failure names WHICH block is missing its cue', () => {
    const blocks = GOOD.split('\n\n');
    blocks[3] = blocks[3].replace(/^\*[^*]+\*\s*/, '');
    const msg = run(withOneScreen(blocks.join('\n\n'))).fails.find((f) => f.startsWith('ONESCREEN_FORMAT:'));
    expect(msg).toMatch(/\b4\b/);
  });

  test('a cue may be any prose, in any script — no English word list', () => {
    const urdu = [
      '*آج کا سبق* دو ۲×۲ میٹرکس کو ضرب دینا، جماعت نہم کی ریاضی کی کتاب کے صفحہ چوبیس سے۔ سبق کے اختتام پر طلبہ دو میٹرکس ضرب دے سکیں گے۔',
      '*پہلے ایک وارم اپ* تین ضرب دو جمع چار ضرب پانچ کا جواب چھبیس ہے۔ یہی ایک سطر پورے قاعدے کا خلاصہ ہے، اس لیے یہیں سے آغاز کریں اور اسے نہ چھوڑیں۔',
      '*تختۂ سیاہ پر کر کے دکھائیں* صفحہ چوبیس کی پہلی مثال، پوری جماعت کے سامنے۔ پہلے ترتیب دیکھیں، پھر ہر خانے کا پتہ بلند آواز میں کہیں، اس کے بعد لکھیں۔',
      '*پھر وہ خود مشق کریں* چار میں سے دو خانے خالی رکھ کر رہنمائی والی مشق، پھر تین انفرادی سوالات۔ اختتام تختے والے چار نمبر کے سوال پر کریں۔',
      '*اس غلطی پر نظر رکھیں* عام غلطی یہ ہے کہ طلبہ ملتے جلتے خانوں کو ضرب دے دیتے ہیں، جیسا جمع میں کیا تھا۔ غلطی ہونے سے پہلے اس کا ذکر کر دیں۔',
      '*جانے سے پہلے* ایک سوال کا اخراجی پرچہ۔ گھر کا کام چار سوالات ہیں، جن میں دو کثیر الانتخابی ہیں، اور ان سب کے جواب حوالہ جاتی حصے میں مکمل درج ہیں۔',
    ].join('\n\n');
    const res = run(withOneScreen(urdu));
    expect(codes(res)).not.toContain('ONESCREEN_FORMAT');
  });

  test('a double asterisk FAILS — WhatsApp prints it, it does not bold it', () => {
    const doubled = GOOD.replace("*Today's lesson*", "**Today's lesson**");
    expect(hasFail(run(withOneScreen(doubled)), 'ONESCREEN_BOLD')).toBe(true);
  });

  test('the double-asterisk message names the dialect, so the author knows which to use', () => {
    const doubled = GOOD.replace("*Today's lesson*", "**Today's lesson**");
    const msg = run(withOneScreen(doubled)).fails.find((f) => f.startsWith('ONESCREEN_BOLD:'));
    expect(msg).toMatch(/WhatsApp/i);
  });

  test('the word budget still binds, and the cues do not buy headroom', () => {
    const tiny = ['*A* one two three.', '*B* four five six.', '*C* seven.', '*D* eight.'].join('\n\n');
    expect(hasFail(run(withOneScreen(tiny)), 'ONESCREEN')).toBe(true);
  });

  test('a doc with no one_screen at all is not newly broken by this rule', () => {
    // ONESCREEN (the word count) is the rule that owns absence; the format rule must not
    // pile a second, confusing failure onto the same missing field.
    const d = load();
    delete d.one_screen;
    const res = run(d);
    expect(hasFail(res, 'ONESCREEN_FORMAT')).toBe(false);
    expect(hasFail(res, 'ONESCREEN_BOLD')).toBe(false);
  });
});

/**
 * bd-lafr9 — and its maths is READ, not typeset.
 *
 * `buildBody` converts TeX to Unicode on the way out (`bot/shared/utils/tex-to-unicode.js`, and
 * `tests/lp612/bd-lafr9-onescreen-latex.test.js` drives that path), which is what repairs the
 * stored backlog: every render cached before the fix still holds the TeX it was authored with.
 * This gate is the other half — it stops NEW documents being written that way, so the converter
 * stays a safety net instead of the only thing between an author's habit and a teacher's screen.
 *
 * Deliberately NOT in `oneScreenShapeDefects`: that predicate is also the worker's reuse-rejection
 * rule, and a rejection there re-authors the document at real cost. A stored body with TeX in it
 * now converts correctly at send time and must keep riding the cache.
 */
describe('bd-lafr9 — one_screen may not carry TeX source', () => {
  // A correctly shaped body whose maths is written the way a teacher reads it.
  const UNICODE_MATHS = GOOD.replace(
    'Work out three times two plus four times five, which is twenty six.',
    'Work out 3 × 2 + 4 × 5, which is 26.',
  );

  test('Unicode maths passes — this is what the author should write', () => {
    expect(hasFail(run(withOneScreen(UNICODE_MATHS)), 'ONESCREEN_TEX')).toBe(false);
  });

  test('a dollar-delimited span FAILS', () => {
    // The exact string a Grade 6 teacher received (grade_6_mathematics.c02.p040-041).
    const tex = GOOD.replace('Worked example one on page 24', 'Solve$-6 \\times \\square = -540$');
    expect(hasFail(run(withOneScreen(tex)), 'ONESCREEN_TEX')).toBe(true);
  });

  test('a backslash command FAILS even with no dollars around it', () => {
    const tex = GOOD.replace('three times two', 'three \\times two');
    expect(hasFail(run(withOneScreen(tex)), 'ONESCREEN_TEX')).toBe(true);
  });

  test('the message quotes the offending TeX and names the character to write instead', () => {
    const tex = GOOD.replace('Worked example one on page 24', 'Solve$\\sqrt{2} \\cdot \\sqrt{8} = 4$');
    const msg = run(withOneScreen(tex)).fails.find((f) => f.startsWith('ONESCREEN_TEX:'));
    expect(msg).toMatch(/√/);
    expect(msg).toMatch(/WhatsApp/i);
  });

  test('an Urdu body is judged on its maths, not its script', () => {
    const urdu = [
      '*آج کا سبق* دو ۲×۲ میٹرکس کو ضرب دینا، جماعت نہم کی ریاضی کی کتاب کے صفحہ چوبیس سے۔ سبق کے اختتام پر طلبہ دو میٹرکس ضرب دے سکیں گے۔',
      '*پہلے ایک وارم اپ* $4x(x+y)$ کو حل کریں۔ یہی ایک سطر پورے قاعدے کا خلاصہ ہے، اس لیے یہیں سے آغاز کریں اور اسے نہ چھوڑیں۔',
      '*تختۂ سیاہ پر کر کے دکھائیں* صفحہ چوبیس کی پہلی مثال، پوری جماعت کے سامنے۔ پہلے ترتیب دیکھیں، پھر ہر خانے کا پتہ بلند آواز میں کہیں، اس کے بعد لکھیں۔',
      '*پھر وہ خود مشق کریں* چار میں سے دو خانے خالی رکھ کر رہنمائی والی مشق، پھر تین انفرادی سوالات۔ اختتام تختے والے چار نمبر کے سوال پر کریں۔',
      '*اس غلطی پر نظر رکھیں* عام غلطی یہ ہے کہ طلبہ ملتے جلتے خانوں کو ضرب دے دیتے ہیں، جیسا جمع میں کیا تھا۔ غلطی ہونے سے پہلے اس کا ذکر کر دیں۔',
      '*جانے سے پہلے* ایک سوال کا اخراجی پرچہ۔ گھر کا کام چار سوالات ہیں، جن میں دو کثیر الانتخابی ہیں، اور ان سب کے جواب حوالہ جاتی حصے میں مکمل درج ہیں۔',
    ].join('\n\n');
    expect(hasFail(run(withOneScreen(urdu)), 'ONESCREEN_TEX')).toBe(true);
  });

  test('the shipped fixture carries no TeX', () => {
    expect(hasFail(run(load()), 'ONESCREEN_TEX')).toBe(false);
  });

  test('a doc with no one_screen at all is not newly broken by this rule', () => {
    const d = load();
    delete d.one_screen;
    expect(hasFail(run(d), 'ONESCREEN_TEX')).toBe(false);
  });
});

describe('the schemas describe the shape', () => {
  test.each([
    ['lp_doc.schema.json', 3.0],
    ['lp_doc.v2.schema.json', 2.0],
  ])('%s documents the paragraph-per-beat format', (file) => {
    const s = JSON.parse(fs.readFileSync(path.join(VENDOR, 'schema', file), 'utf8'));
    const desc = s.properties.one_screen.description;
    expect(desc).toMatch(/blank line|paragraph/i);
    expect(desc).toMatch(/\*/);
  });
});

describe('all four briefs teach the shape', () => {
  // One brief plus three flash variants whose tails reproduce it verbatim. An author routed to
  // a flash variant never reads the parent, so an instruction in one of the four is an
  // instruction to nobody.
  test.each(BRIEFS)('%s gives one_screen its own formatting instruction', (f) => {
    const src = briefSrc(f);
    const para = src.split('\n\n').find((p) => p.includes('bd-uu4lr'));
    expect(para).toBeTruthy();
    expect(para).toMatch(/one_screen/);
    expect(para).toMatch(/blank line/i);
  });

  test.each(BRIEFS)('%s names the single-asterisk dialect and the trap', (f) => {
    const src = briefSrc(f);
    const para = src.split('\n\n').find((p) => p.includes('bd-uu4lr'));
    expect(para).toMatch(/WhatsApp/);
    expect(para).toMatch(/\*\*/); // it has to SHOW the wrong form to forbid it
  });

  test.each(BRIEFS)('%s keeps the word budget unchanged at 150-260', (f) => {
    expect(briefSrc(f)).toMatch(/150[-–]260/);
  });

  test.each(BRIEFS)('%s updates the JSON skeleton line for one_screen', (f) => {
    const line = briefSrc(f).split('\n').find((l) => l.includes('"one_screen":'));
    expect(line).toBeTruthy();
    expect(line).toMatch(/\*/);
  });

  /**
   * bd-lafr9 — the brief has to teach the Unicode-maths rule, not just the gate.
   *
   * A lint fail does not block delivery (`lp612-author.service.js` records `lintClean: false` and
   * carries the fails into the render row); what it does is drive an author REPAIR ROUND. So a gate
   * the brief never mentions costs a real LLM call every time an author writes the TeX they were
   * never told to avoid. Naming the rule up front is what makes `ONESCREEN_TEX` cheap.
   */
  test.each(BRIEFS)('%s tells the author to write maths as Unicode, not TeX', (f) => {
    const para = briefSrc(f).split('\n\n').find((p) => p.includes('ONESCREEN_TEX'));
    expect(para).toBeTruthy();
    // It must show the characters to write, not merely forbid the ones not to.
    expect(para).toMatch(/×/);
    expect(para).toMatch(/√/);
    // And it must name what is banned, in the form an author would otherwise type.
    expect(para).toMatch(/\\times/);
    expect(para).toMatch(/dollar/i);
  });
});
