/**
 * bd-x0pw1 — the EXAM BANK, and what "optional" turned out to mean.
 *
 * FIRST READING (wrong): *"exam qs would be as optional"* was taken as DEFAULT-OFF — drop the
 * section from the required set AND stop the briefs authoring one. The operator corrected it:
 *
 *   *"we need an exam bank whose heading is FBISE format Questions - (Optional) …
 *     the FBISE style Qs can be in referene"*
 *
 * So the optionality is addressed to the TEACHER, in ink, and not to the author. The bank stays,
 * the briefs keep ordering one, and the printed heading carries the word (Optional) so a teacher
 * reading the reference page knows the questions under it are hers to use or skip — the same way
 * she already treats the differentiation rows.
 *
 * WHAT SURVIVES OF THE FIRST READING, deliberately: the schema and lint half. `page2.exam_bank`
 * is no longer in either schema's `page2.required`, and rule 9 is gated on the bank being present.
 * An LP that ships without one is now a legal shape rather than a SCHEMA failure that kills every
 * other lint rule on the document (`lint_lp.js:257-261` returns early on SCHEMA). That is worth
 * keeping whatever the briefs order: it means the bank's absence is a quiet gap, not a wrecked
 * validation run. What it is NOT is an instruction to the author — the briefs are the layer that
 * decides what gets written, and they say: write one.
 *
 * THE COMPLETENESS RULE IS UNCHANGED. A bank that DOES ship still owes 2 distractor-coded MCQs,
 * an SRQ mark scheme and an ERQ skeleton — hard fail at grades 9-12, warn at 6-8. A teacher who
 * sees the heading expects the dose under it.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));
const { lint } = require(path.join(VENDOR, 'lint_lp.js'));
const { validateDoc } = require(path.join(VENDOR, 'lib', 'validate'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(FIXTURE, 'utf8');
const load = () => JSON.parse(raw);

/** The printed heading, exactly as the operator wrote it. */
const HEADING = 'FBISE format Questions - (Optional)';
const HEADING_UR = 'ایف بی آئی ایس ای طرز کے سوالات — (اختیاری)';

/** The fixture with the exam bank taken away — legal, but not what an author should produce. */
function noBank() {
  const d = load();
  delete d.page2.exam_bank;
  return d;
}

const build = (doc, lang = 'en') =>
  buildHtml(doc, { docDir: path.dirname(FIXTURE), lang }).html;

/** See the sibling suite: `atom()` decorates the bar, and continuation bars repeat a letter. */
const barLetters = (html) =>
  [...html.matchAll(/<div[^>]*class="[^"]*\bp2bar\b([^"]*)"[^>]*data-sec="p2-([A-Z])"/g)]
    .filter((m) => !/\bcont\b/.test(m[1]))
    .map((m) => m[2]);

/**
 * Does the rendered page carry an element of this class?
 *
 * NOT `toContain('class="mcq"')`. `atom()` appends its own classes to whatever it decorates —
 * the MCQ block ships as `<div data-atom class="mcq sp-1" data-sec="p2-E">` — so the exact
 * string never appears, and a `not.toContain` written that way passes whether or not the
 * block is painted. That is a test that can only ever agree with you.
 */
const hasClass = (html, name) =>
  new RegExp(`class="[^"]*\\b${name}\\b`).test(html);

const codesOf = (list) => list.map((s) => String(s).split(':')[0]);

// ── 1. the printed heading ───────────────────────────────────────────────────
/**
 * The whole of the operator's correction lands here. "Exam bank" was a filing label — it told a
 * teacher which drawer the questions were in, not what they were for or whether she had to use
 * them. The new heading does both jobs: FBISE names the register the questions are written in,
 * and (Optional) is the permission she was otherwise left to guess at.
 */
describe('the exam bank prints under the operator\'s heading', () => {
  test('English: the section is headed "FBISE format Questions - (Optional)"', () => {
    const html = build(load());
    expect(html).toContain(HEADING);
    expect(html).not.toContain('Exam bank');
  });

  test('Urdu gets the same heading in its own script, (Optional) included', () => {
    // The freeze on `/page2/exam_bank` keeps the QUESTIONS in the book's language; the HEADING is
    // the renderer's own furniture and follows the page, like every other p2 label.
    const html = build(load(), 'ur');
    expect(html).toContain(HEADING_UR);
    expect(html).not.toContain('امتحانی سوالات');
  });

  test('the heading says (Optional) once, not twice — no "(Optional) (optional)" doubling', () => {
    const html = build(load());
    expect(html.split(HEADING).length - 1).toBe(1);
  });
});

// ── 2. the bank is still the normal shape of an LP ───────────────────────────
describe('a normal LP carries an exam bank', () => {
  test('the fixture is grade 9 and carries a COMPLETE bank — the strict branch of rule 9', () => {
    const d = load();
    expect(d.provenance.grade).toBeGreaterThanOrEqual(9);
    const eb = d.page2.exam_bank;
    expect(eb.mcq.length).toBeGreaterThanOrEqual(2);
    expect(eb.srq.mark_scheme.length).toBeGreaterThan(0);
    expect(eb.erq_skeleton.parts.length).toBeGreaterThan(0);
  });

  test('it renders, and the letters run A…H as they always did', () => {
    const html = build(load());
    expect(hasClass(html, 'mcq')).toBe(true);
    expect(barLetters(html)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  });

  test('a bank that IS present must still be complete', () => {
    // Ship one MCQ on a grade-9 plan and it is still a fail. This is the half of rule 9 that the
    // operator never asked to move, and the reason the heading can promise a dose.
    const d = load();
    d.page2.exam_bank.mcq = d.page2.exam_bank.mcq.slice(0, 1);
    const { fails } = lint(d);
    expect(fails.some((f) => f.startsWith('EXAM') && /MCQ/i.test(f))).toBe(true);
  });

  test('a present bank still owes its SRQ mark scheme and its ERQ skeleton', () => {
    const d = load();
    delete d.page2.exam_bank.srq;
    delete d.page2.exam_bank.erq_skeleton;
    const { fails } = lint(d);
    expect(fails.some((f) => f.startsWith('EXAM') && /SRQ/.test(f))).toBe(true);
    expect(fails.some((f) => f.startsWith('EXAM') && /ERQ/.test(f))).toBe(true);
  });
});

// ── 3. absence stays LEGAL — the half of the first reading that was right ────
/**
 * Not an instruction to omit it. This is only the difference between "no bank" reading as a gap
 * and "no bank" reading as a SCHEMA failure — and a SCHEMA failure returns early, taking all
 * forty-odd other lint rules down with it. The briefs order a bank; the validator does not have
 * to detonate when one is missing.
 */
describe('an LP without a bank is still a legal document', () => {
  test('a 3.0 doc without an exam bank validates', () => {
    const v = validateDoc(noBank());
    expect(v.schema).toBe('lp_doc.schema.json');
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  test('the frozen 2.0 schema stops requiring it too', () => {
    // The 2,600+ stored LPs are judged against their own file, which carries the same entry.
    // Asserted on the ERRORS, not on `ok`: this 3.0 fixture is not a valid 2.0 doc for
    // unrelated reasons, and the only question here is whether `exam_bank` is still demanded.
    const d = noBank();
    d.schema_version = '2.0';
    const v = validateDoc(d);
    expect(v.schema).toBe('lp_doc.v2.schema.json');
    expect(v.errors.filter((e) => /exam_bank/.test(e))).toEqual([]);
  });

  test('a grade-9 LP with no bank lints with no SCHEMA and no EXAM complaint', () => {
    const { fails, warns } = lint(noBank());
    expect(codesOf(fails)).not.toContain('SCHEMA');
    expect(fails.filter((f) => /^EXAM/.test(f))).toEqual([]);
    expect(warns.filter((w) => /^EXAM/.test(w))).toEqual([]);
  });

  test('and a grade-7 LP with no bank draws not even the middle-school nudge', () => {
    // `board_weight` goes with the grade, not with this rule: it is an FBISE badge, and rule 9's
    // neighbour warns whenever one is set below SSC. Leaving the grade-9 fixture's badge in place
    // would make this test pass or fail on that rule instead of on the exam bank.
    const d = noBank();
    d.provenance.grade = 7;
    d.board_weight = null;
    const { warns } = lint(d);
    expect(warns.filter((w) => /^EXAM/.test(w))).toEqual([]);
  });

  test('and the page simply closes up behind it — no empty heading', () => {
    const html = build(noBank());
    expect(html).not.toContain(HEADING);
    expect(hasClass(html, 'mcq')).toBe(false);
    const letters = barLetters(html);
    expect(letters).toEqual(letters.map((_, i) => String.fromCharCode(65 + i)));
  });
});

// ── 4. the briefs ────────────────────────────────────────────────────────────
/**
 * The layer that actually decides what gets written.
 *
 * Schema and lint only say what is ALLOWED. What an LP contains is decided by the four author
 * briefs, and the flash briefs are the louder half of that: each carries a COMPLETE worked lp_doc,
 * and a model copies a worked example far more faithfully than it follows prose. So the operator's
 * "we need an exam bank" has to be true in the worked examples, not only in the paragraphs.
 */
describe('the author briefs order an exam bank, and name its printed heading', () => {
  const BRIEFS = [
    'brief_author_v3.md',
    'brief_author_v3_flash_sci.md',
    'brief_author_v3_flash_prose.md',
    'brief_author_v3_flash_maths.md',
  ];
  const briefSrc = (f) => fs.readFileSync(path.join(VENDOR, f), 'utf8');

  test.each(BRIEFS)('%s still orders at least 2 distractor-coded MCQs', (f) => {
    expect(briefSrc(f)).toMatch(/at least 2 MCQs/i);
  });

  test.each(BRIEFS)('%s tells the author what the heading will say', (f) => {
    // Without this the author cannot know the word (Optional) is already printed for her, and
    // writes "(optional)" into the question text — the doubling test above is its other half.
    const src = briefSrc(f);
    expect(src).toContain(HEADING);
    expect(src).toContain('bd-x0pw1');
  });

  test.each(BRIEFS)('%s keeps the ur_overlay freeze on /page2/exam_bank', (f) => {
    // The heading is translated; the questions are not. This note must survive the change.
    expect(briefSrc(f)).toContain('anything under `/page2/exam_bank`');
  });

  /** The one complete lp_doc in each flash brief — the thing the model imitates. */
  const workedExample = (f) =>
    [...briefSrc(f).matchAll(/```json\n([\s\S]*?)\n```/g)]
      .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
      // `d.page2` alone is not enough — each brief also carries small atom/figure fragments, and
      // the worked example is the only block that is a whole document.
      .find((d) => d && d.page2 && d.sections);

  test.each(BRIEFS.slice(1))('%s: its worked example ships a complete bank', (f) => {
    const doc = workedExample(f);
    expect(doc).toBeTruthy();
    const eb = doc.page2.exam_bank;
    expect(eb).toBeTruthy();
    expect(eb.mcq.length).toBeGreaterThanOrEqual(2);
    expect(eb.srq).toBeTruthy();
    expect(eb.erq_skeleton).toBeTruthy();

    // Asserted on the exam-bank slice, not on `errors`/`fails` wholesale: these three worked
    // examples each fail schema on a missing top-level `provenance`, which predates this change
    // (the briefs claim they "return zero errors" — they do not). Filed as bd-3tbt6; asserting
    // `fails).toEqual([])` here would make this suite the reporter for an unrelated defect.
    const v = validateDoc(doc);
    expect(v.errors.filter((e) => /exam_bank/.test(e))).toEqual([]);
  });
});
