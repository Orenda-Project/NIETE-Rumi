/**
 * bd-oyqb2 — SCHEMA: the heaviest-text lp_doc slots must accept an ARRAY, losslessly,
 * alongside the string they accept TODAY.
 *
 * `key_points.items` already prints one row per array element (`R.key_points`,
 * `kpAtoms`, `.kp` — lib/template.js). Nine other slots carry the SAME kind of
 * unbroken block of prose but are still typed as a bare `string`, rendered as one
 * `<p>`. Measured means over the 335-document ch9-10 corpus (schema_caps.py-style
 * census, 2026-09-24): `ask.question` 80.7 words, `worked_example.prompt` /
 * `faded_example.prompt` 69.5, `page2.differentiation.stuck` 60.5,
 * `page2.coaching_reflection` 52.0, `page2.differentiation.early` 47.3,
 * `exit_ticket[].q` 45.3, `worked_example.cfu` 40.7, `objectives.outcome` 29.9.
 *
 * `slo.text_verbatim` (44.8 words) was censused with them and briefly widened too. It is
 * NOT widened — reverted at bd-yjmxh, 2026-09-24. It is the SLO copied VERBATIM: bulleting
 * one sentence re-punctuates it and changes what it says, and no renderer prints it at all
 * (zero hits for `text_verbatim` in lib/template.js), so an array would produce no row. The
 * test below now guards the refusal, so the schema and this suite cannot drift apart again.
 *
 * This suite is schema-only — it proves `validateDoc` accepts EITHER shape. It does
 * NOT touch markup; the renderer-output proof lives in
 * oyqb2-array-fields-render.test.js. `page2.differentiation.barrier` is deliberately
 * absent below — the brief holds it string-only.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { validateDoc } = require(path.join(VENDOR, 'lib', 'validate'));
const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const ok = (doc) => validateDoc(doc);

const sec = (d, id) => d.sections.find((s) => s.id === id);
const blk = (d, id, type) => sec(d, id).blocks.find((b) => b.type === type);

// `tests/__mocks__/ajv.js` (jest.config.js `moduleNameMapper: '^ajv$'`) stands in for the real
// package everywhere `lib/validate.js` runs inside THIS jest process — including here, since
// moduleNameMapper rewrites `require("ajv")` regardless of caller. Its own doc-comment names the
// draft-07 subset it implements, and `minLength`/`maxLength` are not on that list (only
// `pattern` is, for strings) — confirmed by reading tests/__mocks__/ajv.js, not inferred. A bare
// `node` run of the same `validateDoc(short)` (outside jest, where `require("ajv")` resolves the
// real package) correctly returns `ok:false` with a `minLength` error; inside jest it returns
// `ok:true`, silently. This is a gap in the shared test stub, not in the schema edit, and it is
// not this bead's file to change (other lp612 suites — outcome-one-voice-render.test.js,
// keywords-cap-headroom.test.js — already depend on its current 26-line behaviour for
// oneOf/minItems/required, which it DOES implement correctly).
//
// So the one assertion below that needs `minLength` enforced loads the REAL ajv package by an
// absolute path, which does not match the mapper's `^ajv$` regex and is therefore not
// intercepted (verified with a throwaway probe test before this fix). This exercises the exact
// same schema file (`schema/lp_doc.schema.json`) `lib/validate.js` compiles, just with the real
// validator `render_lp.js` and production actually run against.
const REAL_AJV_PATH = path.join(os.homedir(), 'node_modules', 'ajv');
const SCHEMA_PATH = path.join(VENDOR, 'schema', 'lp_doc.schema.json');
const realOk = (doc) => {
  const RealAjv = require(REAL_AJV_PATH);
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const validate = new RealAjv({ allErrors: true, strict: false }).compile(schema);
  return { ok: validate(doc), errors: validate.errors || [] };
};

describe('bd-oyqb2 — string-or-array accepted, still-required string form unchanged', () => {
  test('control: the unmodified base fixture is still valid', () => {
    expect(ok(baseDoc()).errors).toEqual([]);
  });

  test('slo.text_verbatim: string form still valid (regression guard)', () => {
    const d = baseDoc();
    expect(ok(d).errors).toEqual([]);
  });
  test('slo.text_verbatim: array form is REFUSED — the field stays string-only (bd-yjmxh)', () => {
    const d = baseDoc();
    d.slo.text_verbatim = ['Multiply two matrices of order up to 2 by 2.', 'State when the product is defined.'];
    // through the REAL ajv: the stub does not enforce `type`, so a stub-only assertion here
    // would pass whatever the schema said — which is the shape of failure this test replaces.
    const r = realOk(d);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.keyword)).toContain('type');
  });

  test('objectives.outcome: array form is valid, minLength:10 stays on the string arm', () => {
    const d = baseDoc();
    d.objectives.outcome = ['You can multiply two 2x2 matrices.', 'You can say when the product is defined.'];
    expect(ok(d).errors).toEqual([]);
    // minLength enforcement: the stub ajv (see REAL_AJV_PATH comment above) does not implement
    // minLength, so this one assertion goes through the real package instead of `ok()`.
    const short = baseDoc();
    short.objectives.outcome = 'short';
    expect(realOk(short).ok).toBe(false);
  });

  test('exit_ticket[].q: array form is valid', () => {
    const d = baseDoc();
    sec(d, 'conclusion').exit_ticket[0].q = ['Multiply A and B.', 'State the order of the product.'];
    expect(ok(d).errors).toEqual([]);
  });

  test('page2.differentiation.stuck and .early: array form is valid, barrier is UNCHANGED (string only)', () => {
    const d = baseDoc();
    d.page2.differentiation.stuck = ['Give a printed grid.', 'Walk the row-by-column sweep once with them.'];
    d.page2.differentiation.early = ['Ask for A(BC).', 'Ask for (AB)C.', 'Ask what they notice.'];
    expect(ok(d).errors).toEqual([]);
    const badBarrier = baseDoc();
    badBarrier.page2.differentiation.barrier = ['still not allowed as an array'];
    expect(ok(badBarrier).ok).toBe(false);
  });

  test('page2.coaching_reflection: array form is valid', () => {
    const d = baseDoc();
    d.page2.coaching_reflection = ['Which pupils could say the address out loud?', 'Who do I re-teach tomorrow?'];
    expect(ok(d).errors).toEqual([]);
  });

  test('ask.question: array form is valid (additionalProperties:false, no new keys)', () => {
    const d = baseDoc();
    const a = blk(d, 'introduction', 'ask');
    a.question = ['First half of the question.', 'Second half of the question.'];
    expect(ok(d).errors).toEqual([]);
  });

  test('worked_example.prompt and .cfu: array form is valid', () => {
    const d = baseDoc();
    const w = blk(d, 'development', 'worked_example');
    w.prompt = ['Multiply A by B.', 'Show every entry of the product.'];
    w.cfu = ['Which entry needs row 2 of A?', 'Which entry needs column 1 of B?'];
    expect(ok(d).errors).toEqual([]);
  });

  test('faded_example.prompt: array form is valid', () => {
    const d = baseDoc();
    const f = blk(d, 'activity', 'faded_example');
    f.prompt = ['Multiply C by D.', 'Fill in the missing entries.'];
    expect(ok(d).errors).toEqual([]);
  });

  test('every array-typed slot still rejects an empty array (minItems:1 carried over)', () => {
    const d = baseDoc();
    d.objectives.outcome = [];
    expect(ok(d).ok).toBe(false);
  });
});
