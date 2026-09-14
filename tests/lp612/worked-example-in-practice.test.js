/**
 * bd-4pw4y — the WORKED EXAMPLE is required, and it lives in the practice sections.
 *
 * Operator, 2026-09-12: *"we need worked examples, but it should be in the practice sections of the
 * LP not in reference, the FBISE style Qs can be in referene"*.
 *
 * READ IT ALONGSIDE bd-s19g8, because that is what it is answering. bd-s19g8 took the two answer
 * keys off the support page — `page2.model_answers` and `page2.homework_key`, the worked-out
 * answers a teacher had to turn the page to reach. This instruction confirms that removal and names
 * the thing that must not vanish with it: the pedagogical worked example, the I-do the teacher
 * performs in front of the class. It was never the same object as a model answer. A model answer is
 * the finished result, filed at the back for marking; a worked example is the method, performed in
 * the middle of the lesson at the moment it is being taught. Losing the keys is fine. Losing the
 * I-do would leave a plan that asks pupils to practise something nobody demonstrated.
 *
 * THE GAP THIS CLOSES. Nothing required a worked example to exist:
 *   - `lint_lp.js` knew `worked_example` only as one of four ACT_TYPES counted against the <=7
 *     activity cap, and as a block whose prompt must be fully worded (UNWORDED_Q). Neither rule
 *     fires when the block is simply absent.
 *   - `brief_author_v3.md:143` orders "worked example (I do) · backward-faded practice (We do) ·
 *     independent practice (You do)" — but only inside the **STEM-2 New-Procedure Day** archetype.
 *     Every other archetype, and every prose and maths lesson that is not STEM-2, was silent.
 *   - the schema carries the block type but never requires an instance.
 *
 * So all three layers ALLOWED a worked example and none of them ASKED for one. The flash briefs'
 * worked lp_docs happen to carry one each, which is why nobody noticed: the model was imitating a
 * habit, not following a rule, and a habit is exactly what drops out under pressure.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { lint } = require(path.join(VENDOR, 'lint_lp.js'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(FIXTURE, 'utf8');
const load = () => JSON.parse(raw);

/** Blocks nest — `split` carries `left`/`right`, and a block may carry `blocks` of its own. */
const walk = (bs) => (bs || []).flatMap((b) => [b, ...walk(b.blocks), ...walk(b.left), ...walk(b.right)]);
const blocksOf = (doc) => doc.sections.flatMap((s) => walk(s.blocks));
const typesOf = (doc) => blocksOf(doc).map((b) => b.type);

/** The fixture with its I-do taken out, and nothing else touched. */
function noWorked() {
  const d = load();
  for (const s of d.sections) {
    const strip = (bs) => (bs || []).filter((b) => b.type !== 'worked_example')
      .map((b) => ({ ...b, ...(b.blocks ? { blocks: strip(b.blocks) } : {}),
                          ...(b.left ? { left: strip(b.left) } : {}),
                          ...(b.right ? { right: strip(b.right) } : {}) }));
    s.blocks = strip(s.blocks);
  }
  return d;
}

const codesOf = (list) => list.map((s) => String(s).split(':')[0]);

describe('lint requires a worked example in the teaching flow', () => {
  test('the fixture carries exactly the I-do / We-do / You-do trio — a fair test of the rule', () => {
    const t = typesOf(load());
    expect(t.filter((x) => x === 'worked_example')).toHaveLength(1);
    expect(t.filter((x) => x === 'faded_example')).toHaveLength(1);
    expect(t.filter((x) => x === 'practice')).toHaveLength(1);
  });

  test('an LP whose sections carry no worked_example fails', () => {
    const { fails } = lint(noWorked());
    expect(codesOf(fails)).toContain('WORKED_ABSENT');
  });

  test('and the complaint names the practice sections, not the reference block', () => {
    // The whole point of the operator's sentence is WHERE it goes. A message that says only
    // "add a worked example" invites the author to put one back on page 2, which is the shape
    // bd-s19g8 just removed.
    const { fails } = lint(noWorked());
    const msg = fails.find((f) => f.startsWith('WORKED_ABSENT'));
    expect(msg).toMatch(/practice|I do|teaching flow/i);
    expect(msg).not.toMatch(/page2|reference block/i);
  });

  test('the unmodified fixture draws no such complaint', () => {
    const { fails, warns } = lint(load());
    expect(codesOf(fails)).not.toContain('WORKED_ABSENT');
    expect(codesOf(warns)).not.toContain('WORKED_ABSENT');
  });

  test('removing the I-do does not smuggle in an ACTIVITIES pass as the "fix"', () => {
    // Guard against a lazy reading of the cap: an LP can always get under <=7 activities by
    // deleting the demonstration, and the two rules must not reward that trade.
    const { fails } = lint(noWorked());
    expect(codesOf(fails)).not.toContain('ACTIVITIES');
    expect(codesOf(fails)).toContain('WORKED_ABSENT');
  });
});

describe('the briefs ask for it everywhere, not only on a STEM-2 day', () => {
  const BRIEFS = [
    'brief_author_v3.md',
    'brief_author_v3_flash_sci.md',
    'brief_author_v3_flash_prose.md',
    'brief_author_v3_flash_maths.md',
  ];
  const briefSrc = (f) => fs.readFileSync(path.join(VENDOR, f), 'utf8');

  test.each(BRIEFS)('%s makes the worked example a rule, not an archetype detail', (f) => {
    expect(briefSrc(f)).toContain('bd-4pw4y');
  });

  test.each(BRIEFS)('%s says where it goes, and where it does not', (f) => {
    const src = briefSrc(f);
    // Named together in one place, so the author cannot read the requirement without the location.
    const para = src.split('\n\n').find((p) => p.includes('bd-4pw4y'));
    expect(para).toBeTruthy();
    expect(para).toMatch(/reference block/i);
    expect(para).toMatch(/worked_example/);
  });

  /** The one complete lp_doc in each flash brief — the thing the model imitates. */
  const workedExample = (f) =>
    [...briefSrc(f).matchAll(/```json\n([\s\S]*?)\n```/g)]
      .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
      .find((d) => d && d.page2 && d.sections);

  test.each(BRIEFS.slice(1))('%s: its worked example demonstrates the I-do on page 1', (f) => {
    const doc = workedExample(f);
    expect(doc).toBeTruthy();
    expect(typesOf(doc).filter((t) => t === 'worked_example').length).toBeGreaterThanOrEqual(1);
  });

  test.each(BRIEFS.slice(1))('%s: the worked-out demonstration stays on page 1, and only the HOMEWORK key is in reference', (f) => {
    // The other half of the operator's sentence: the demonstration moved to page 1 and
    // `model_answers` — the class-flow key, which duplicated answers the items already carry —
    // did not come back with it. The HOMEWORK key DID, on her *"hw answers come back"*
    // (bd-yprue): homework is the one set of questions whose answers a teacher cannot read off
    // the plan's own class flow, and Reference is the page the pupils never see.
    const doc = workedExample(f);
    expect(doc.page2.model_answers).toBeUndefined();
    expect(Array.isArray(doc.page2.homework_key)).toBe(true);
    // …while the FBISE-style questions are exactly what the reference block is allowed to keep.
    expect(doc.page2.exam_bank).toBeTruthy();
  });
});
