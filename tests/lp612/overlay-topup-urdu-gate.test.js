/**
 * THE URDU GATE MUST JUDGE THE PAGE, NOT THE PATCH — bd-htw51 (blocks bd-idneu).
 *
 * `overlayLessonPlan` has two gates and, until this bead, they disagreed about what they were
 * looking at.
 *
 *   GATE 2 (coverage) measures the MERGE — `{ ...kept, ...base }` — and says so in its own
 *   comment: "What this gate protects is the page the teacher receives, which is the merge."
 *   GATE 1 (is it Urdu at all) measured `kept` ALONE: only what this call produced.
 *
 * On the authoring path the two are the same thing, because `base` is empty. On a TOP-UP they are
 * not. bd-idneu asks for the two pointers bd-x3dn6 widened the target set by — `/provenance/chapter`
 * and `/provenance/topic` — on documents whose other ninety strings were translated months ago.
 * Those two strings are chapter numbers, book names and the technical terms the overlay brief
 * itself orders kept as terms of record. Judged alone they came back 30.9%–47.9% Urdu by letter
 * and the 50% floor refused them. Judged on the page that actually renders they are two lines in
 * a document that is otherwise entirely Urdu.
 *
 * MEASURED AGAINST PRODUCTION, 2026-09-18: the live bd-idneu run attempted 23 rows and 8 of them
 * died here — grade_12_chemistry.c10.r990 at 30.9%, grade_10_physics.c16.p185-188 at 42.0%, and
 * six more. Nothing was written; the run aborted with production untouched.
 *
 * What is pinned:
 *
 *   • a top-up whose new strings are Latin-heavy but whose DOCUMENT is Urdu is accepted;
 *   • an AUTHORING call with an English overlay is still refused — the floor has not moved, and
 *     an empty `base` means merged === kept, so that path is untouched;
 *   • the refusal, when it comes, still reports the share it measured;
 *   • a top-up onto a document that is itself mostly English is still refused, so the gate has not
 *     been turned into a rubber stamp by the presence of ANY base;
 *   • an ENGLISH answer to a two-string top-up is still refused, even though ninety Urdu strings
 *     would carry the merge over the floor on their own. Measuring only the merge would have made
 *     the floor unfalsifiable here, and `overlay-topup.e2e.test.js` already pins that guarantee
 *     one layer up.
 *
 * Red-first on bd-vrt20-backfill-run-driver: the top-up tests throw OVERLAY_NOT_URDU at 37.1%.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { overlayDefects } = require(path.join(V, 'lint_lp.js'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const rawFixture = fs.readFileSync(BASE, 'utf8');
const doc = () => JSON.parse(rawFixture);

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return {
    getClient: () => ({ chat: { completions: { create } } }),
    getClientForModel: (m) => ({ client: { chat: { completions: { create } } }, model: String(m || '') }),
    __create: create,
  };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const create = require('../../bot/shared/services/llm-client').__create;
const { overlayLessonPlan } = require('../../bot/shared/services/lp612-author.service');

const reply = (obj) => ({
  choices: [{ message: { content: JSON.stringify(obj) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
});

const SEGMENT = { segment_id: 'grade_12_chemistry.c10.r990', subject: 'Chemistry', grade: 12 };

/** The two pointers bd-idneu tops up, and nothing else. */
const TOPUP = ['/provenance/chapter', '/provenance/topic'];

/**
 * The 90 strings already on the stored document — real Urdu prose, translated months ago.
 * This is what `baseOverlay` carries and what the teacher's page is actually made of.
 */
function storedOverlay(d) {
  const out = {};
  for (const ptr of overlayDefects.targets(d)) {
    if (TOPUP.includes(ptr)) continue;
    out[ptr] = 'یہ ہدایت استاد کے لیے اردو میں لکھی گئی ہے۔';
  }
  return out;
}

/**
 * What the model returns for the two provenance pointers: a correct Urdu translation that keeps
 * the chemistry term of record in Latin, because the overlay brief orders it kept. 21 Urdu
 * letters against a run of Latin ones — 37.1%, below the 50% floor and well above an English answer's
 * zero.
 */
const LATIN_HEAVY = {
  '/provenance/chapter': 'باب 10 · Chemical Equilibrium',
  '/provenance/topic': 'حالتِ توازن اور Le Chatelier Principle کا اطلاق',
};

const urduLetters = (s) => (String(s).match(/[؀-ۿݐ-ݿ]/g) || []).length;
const latinLetters = (s) => (String(s).match(/[A-Za-z]/g) || []).length;
const shareOf = (strings) => {
  const joined = strings.join(' ');
  const u = urduLetters(joined);
  const l = latinLetters(joined);
  return u + l ? u / (u + l) : 0;
};

beforeEach(() => jest.clearAllMocks());

describe('a two-string provenance top-up is judged on the document it lands in', () => {
  test('the fixture really is the failing case — the new strings alone are under the floor', () => {
    // If this ever stops being true the suite below proves nothing, so it is asserted, not assumed.
    expect(shareOf(Object.values(LATIN_HEAVY))).toBeLessThan(0.5);
    expect(shareOf(Object.values(LATIN_HEAVY))).toBeGreaterThan(0.2);
  });

  test('a Latin-heavy provenance patch onto a fully Urdu document is ACCEPTED', async () => {
    const d = doc();
    const base = storedOverlay(d);
    create.mockResolvedValue(reply(LATIN_HEAVY));

    // THE BUG: on bd-vrt20-backfill-run-driver this rejects with OVERLAY_NOT_URDU at 37.1%,
    // which is what killed 8 of the 23 rows the live bd-idneu run attempted.
    const out = await overlayLessonPlan({
      lpDoc: d, segment: SEGMENT, targets: TOPUP, baseOverlay: base,
    });

    expect(Object.keys(out.overlay).sort()).toEqual([...TOPUP].sort());
    expect(out.overlay['/provenance/topic']).toBe(LATIN_HEAVY['/provenance/topic']);
  });

  test('the share it reports is the share of the delivered page, not of the patch', async () => {
    const d = doc();
    create.mockResolvedValue(reply(LATIN_HEAVY));

    const out = await overlayLessonPlan({
      lpDoc: d, segment: SEGMENT, targets: TOPUP, baseOverlay: storedOverlay(d),
    });

    // Rule 24(b): a number the operator reads must be the number the gate decided on.
    expect(out.urduShare).toBeGreaterThan(0.9);
  });
});

describe('the floor has not moved, and the authoring path is untouched', () => {
  test('an AUTHORING call with an English overlay is still refused', async () => {
    const d = doc();
    const english = {};
    for (const ptr of overlayDefects.targets(d)) english[ptr] = 'This instruction is in English.';
    create.mockResolvedValue(reply(english));

    // No baseOverlay: `base` is empty, merged === kept, and this is exactly the code path that
    // ran before this bead. It must be bit-for-bit the same decision.
    await expect(overlayLessonPlan({ lpDoc: d, segment: SEGMENT }))
      .rejects.toMatchObject({ code: 'OVERLAY_NOT_URDU' });
  });

  test('the refusal still names the share it measured', async () => {
    const d = doc();
    const english = {};
    for (const ptr of overlayDefects.targets(d)) english[ptr] = 'This instruction is in English.';
    create.mockResolvedValue(reply(english));

    const err = await overlayLessonPlan({ lpDoc: d, segment: SEGMENT }).catch((e) => e);
    expect(err.code).toBe('OVERLAY_NOT_URDU');
    expect(err.urduShare).toBe(0);
    expect(err.message).toMatch(/0\.0% of its letters are Urdu/);
  });

  test('an ENGLISH answer to the top-up is refused, though the merge would clear the floor', async () => {
    const d = doc();
    const base = storedOverlay(d);
    // Ninety Urdu strings plus two English ones is ~97% Urdu on the merge. The merge gate cannot
    // see this, and it is the same defect as an English overlay — just two lines of it.
    create.mockResolvedValue(reply({
      '/provenance/chapter': 'Chapter 10 - Chemical Equilibrium',
      '/provenance/topic': 'Equilibrium and the Le Chatelier Principle',
    }));

    const err = await overlayLessonPlan({
      lpDoc: d, segment: SEGMENT, targets: TOPUP, baseOverlay: base,
    }).catch((e) => e);

    expect(err.code).toBe('OVERLAY_NOT_URDU');
    expect(err.patchUrduShare).toBe(0);
    expect(err.message).toMatch(/no Urdu script at all/);
  });

  test('a top-up onto a document whose own overlay is English is STILL refused', async () => {
    const d = doc();
    // The presence of a base must not by itself clear the gate. Here the base is the English
    // overlay a broken earlier pass wrote, so the merge is English too and the page is English.
    const englishBase = {};
    for (const ptr of overlayDefects.targets(d)) {
      if (TOPUP.includes(ptr)) continue;
      englishBase[ptr] = 'This instruction is in English.';
    }
    create.mockResolvedValue(reply(LATIN_HEAVY));

    await expect(overlayLessonPlan({
      lpDoc: d, segment: SEGMENT, targets: TOPUP, baseOverlay: englishBase,
    })).rejects.toMatchObject({ code: 'OVERLAY_NOT_URDU' });
  });
});
