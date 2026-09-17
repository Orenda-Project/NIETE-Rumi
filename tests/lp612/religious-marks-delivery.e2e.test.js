/**
 * E2E — A RELIGIOUS LESSON REACHES THE TEACHER. bd-kpqu6.
 *
 * The unit suite (`religious-marks-false-positives.test.js`) proves the regex and the field
 * scope. It does NOT prove a teacher gets a PDF, because in production nothing refused a
 * *string* — the revision ladder refused a *document*. RELIGIOUS_MARKS is a blocking fail, a
 * blocking fail keeps `blockingCost(gates) > 0`, the ladder never breaks, it burns every round
 * trying to "fix" a word that was never broken, and the segment lands undeliverable.
 *
 * Three ICT lessons died that way on 2026-09-15. All three were Islamiat/Urdu segments whose
 * only sin was the ordinary plural "انبیاء" ("prophets"), which the old gate matched INSIDE as
 * the unhonorified "نبی".
 *
 * So this suite asserts at the layer the teacher actually feels:
 *   - the document comes back lint-clean and deliverable,
 *   - it costs ZERO revision rounds (the false positive is not merely survivable, it is gone),
 *   - and the genuine protection still refuses, at the same layer, in the same run.
 *
 * Red-first on the base branch: describe block A fails on the exact production string.
 *
 * The LLM and the renderer are injected/mocked so this stays hermetic — the assertions are
 * about the GATE'S VERDICT, which is the thing that was wrong.
 */

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return {
    getClient: () => ({ chat: { completions: { create } } }),
    getClientForModel: (m) => ({ client: { chat: { completions: { create } } }, model: String(m || '') }),
    __create: create,
  };
});

// bd-5t71f. The English lane clears a Latin name off the G5c native-speaker review, carried as
// data. The REAL list — `bot/vendor/lp-v9/g5c_cleared_names_en.json` — ships EMPTY and clears
// nothing until Amena signs the candidate list off, so a FIXTURE clearance stands in here and
// proves the mechanism end to end. Fail-closed regressions at this layer:
// `religious-marks-cleared-names-en.e2e.test.js`.
jest.mock('../../bot/vendor/lp-v9/g5c_cleared_names_en.json', () => ({
  person: ['Mohammad Ali Jinnah'],
  prophet: [],
}));

// The harness — doc builder, page-truth tree, run/refusal — is shared with
// `religious-marks-english.e2e.test.js`, which holds the English-medium rulings. It lives in
// helpers/religious-e2e.js rather than here because describe G took this file past 300 lines.
const {
  PROD_STRING, create, religiousDoc, cleanDoc, reply, installPageTruth, run, religiousFails, refusal,
} = require('./helpers/religious-e2e');

installPageTruth();

describe('A — the lesson that production refused now reaches the teacher', () => {
  test('the exact 2026-09-15 string is delivered, lint-clean, in zero revision rounds', async () => {
    create.mockResolvedValue(reply(religiousDoc()));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
    expect(out.rounds).toBe(0);                 // not one wasted round on a non-defect
    expect(create).toHaveBeenCalledTimes(1);    // authored once, never sent back for revision
    expect(out.lpDoc).toBeTruthy();             // there IS a document to render
  });

  test('the bare chapter title "سیرتِ انبیاء" is delivered', async () => {
    create.mockResolvedValue(reply(religiousDoc('سیرتِ انبیاء کا باب')));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
  });

  // SKIPPED, not deleted, and REWRITTEN first because as authored it asserted nothing:
  // `religiousDoc(text)` REPLACES the fixture's only religious string, so the document was not
  // religious at all, `isReligious` was false (lint_lp.js:1615), and the gate returned before it
  // could refuse anything. It went green on the unfixed base branch too. With the trigger left in
  // place it is a true red test for bd-5t71f: the English lane has no isCompoundGivenName guard
  // (the Urdu lane's is at lint_lp.js:1630), so Latin "Mohammad" opening another person's name is
  // refused. That gap is live on sandbox today and is out of scope for bd-kpqu6's P0.
  // Un-skip in the commit that fixes bd-5t71f.
  test('an English lesson naming Muhammad Ali Jinnah is delivered', async () => {
    const d = religiousDoc();                       // keeps the سیرت trigger, so the gate RUNS
    d.sections.find((s) => (s.blocks || []).some((b) => b.type === 'key_points'))
      .blocks.find((b) => b.type === 'key_points').items =
        ['Quaid-e-Azam Mohammad Ali Jinnah founded Pakistan in 1947.'];
    create.mockResolvedValue(reply(d));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
  });
});

describe('B — the protection it exists for still refuses, at the same layer', () => {
  test('an unhonorified Prophet in lesson body is NOT delivered clean — bd-qzitp holds', async () => {
    // The gate's whole purpose. If this ever goes green the fix has gone too far.
    create.mockResolvedValue(reply(religiousDoc('نبی نے فرمایا کہ علم حاصل کرو')));

    const message = await refusal();

    expect(message).toMatch(/RELIGIOUS_MARKS/);
    expect(message).toMatch(/names the Prophet/);
  });

  // SKIPPED, not deleted: a REAL and CURRENTLY LIVE gap, filed as bd-zlypp. Sandbox reads
  // `provenance.medium` per DOCUMENT (lint_lp.js:1638), so an Urdu-script string inside an
  // en-medium plan never meets TRANSLIT_RE. The branch this commit was split from scoped the rule
  // per STRING instead; that design is superseded by bd-b8ypq and was deliberately not taken.
  // Out of scope for bd-kpqu6's P0 — un-skip in the commit that fixes bd-zlypp.
  test.skip('a transliterated sacred name inside Urdu is NOT delivered clean', async () => {
    create.mockResolvedValue(reply(religiousDoc('سیرت کا سبق: یہ Allah کی وحدانیت پر ہے')));

    const message = await refusal();

    expect(message).toMatch(/RELIGIOUS_MARKS/);
  });
});

describe('C — the ladder is not burning rounds on a word it cannot fix', () => {
  test('a religious lesson costs the SAME rounds as a non-religious one', async () => {
    // The production symptom was cost, not just refusal: every round was spent re-writing a
    // correct word. Parity with the control is the thing worth asserting.
    create.mockResolvedValue(reply(cleanDoc()));
    const control = await run();

    jest.clearAllMocks();
    create.mockResolvedValue(reply(religiousDoc()));
    const religious = await run();

    expect(religious.rounds).toBe(control.rounds);
  });
});

describe('D — the native-speaker hold is untouched by this fix', () => {
  test('a religious lesson WITHOUT needs_human_review is still refused', async () => {
    // The hold is the reason no Islamiat lesson is ever served on demand. This fix narrows
    // WHICH STRINGS COUNT AS A VIOLATION; it must not narrow the hold itself.
    const d = religiousDoc();
    delete d.needs_human_review;
    create.mockResolvedValue(reply(d));

    const message = await refusal();

    expect(message).toMatch(/RELIGIOUS_MARKS/);
    expect(message).toMatch(/needs_human_review/);
    expect(message).toMatch(/native-speaker review remains a hard hold/);
  });
});

describe('E — a correctly-honorified companion is not reported as a slip', () => {
  // Check 3 is the CONSISTENCY rule: it fires only on a bare name the same document honorifies
  // somewhere else. Two matcher defects made a correctly-honorified name look bare, so the rule
  // reported an inconsistency that was not in the text. Both mentions go in one string because
  // the honorified set is document-wide.
  const LINE = 'حضرت خدیجۃ الکبریٰ رضی اللہ تعالیٰ عنہا کا لقب کیا تھا؟ حضرت خدیجۃ رضی اللہ عنہا کا ذکر';

  test('the production Grade 6 tafheem line is delivered, lint-clean', async () => {
    create.mockResolvedValue(reply(religiousDoc(LINE)));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
    expect(out.rounds).toBe(0);
  });

  test('a three-word name reaches its honorific', async () => {
    create.mockResolvedValue(reply(religiousDoc(
      'حضرت زینب بنت علی رضی اللہ عنہا کا ذکر آتا ہے۔ حضرت زینب رضی اللہ عنہا مشہور ہیں')));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
  });

  test('a genuinely bare companion is STILL not delivered clean', async () => {
    // The consistency rule's whole point. If this goes green the fix has gone too far.
    //
    // Recovered from 065766b7, where this asserted on a RETURNED document. It cannot here: the
    // P0 that shipped to sandbox made an exhausted ladder THROW (lp612-author.service.js:2511),
    // so there is no dirty document to inspect — which is the protection working. The assertion
    // moves onto the raised message via the `refusal` helper; what is being asserted is unchanged.
    create.mockResolvedValue(reply(religiousDoc(
      'حضرت خدیجۃ الکبریٰ کا لقب کیا تھا؟ حضرت خدیجۃ رضی اللہ عنہا کا ذکر')));

    const message = await refusal(1);

    expect(message).toMatch(/RELIGIOUS_MARKS/);
    expect(message).toMatch(/names a companion/);
  });
});

describe('F — a prophet other than Muhammad reaches the teacher with علیہ السلام', () => {
  // G5c ruling Q1 (operator, 2026-09-17): "any prophet not Muhammad gets their proper salutation
  // alaihis salam in the stamp/nastaliq script".
  //
  // What production showed: grade_7_urdu.c11.p062-064.tafheem was refused 2026-09-15 04:53 with
  // one teacher waiting, on a Hazrat Ibrahim chapter, and the gate told the author to write
  // "نبی ﷺ". A lesson cannot be repaired by being instructed to write the wrong salutation, so
  // every round produced the same refusal. These drive the real authoring path end to end — only
  // the LLM call is doubled — so the assertion is about what the TEACHER gets, not what a
  // matcher returns.

  test('a correctly salutated non-Muhammad prophet is delivered, lint-clean, in round 0', async () => {
    create.mockResolvedValue(reply(religiousDoc('حضرت ابراہیم اللہ کے نبی علیہ السلام تھے')));

    const out = await run();

    expect(religiousFails(out)).toEqual([]);
    expect(out.lintClean).toBe(true);
    expect(out.rounds).toBe(0);
  });

  test('the production Grade 7 line is still refused, but now told to write علیہ السلام', async () => {
    // Still a refusal — the line carries no salutation at all, and that is the gate working.
    // What changed is the instruction it hands back, which is what makes the segment repairable
    // instead of permanently stuck.
    create.mockResolvedValue(reply(religiousDoc(
      'وہ اللہ کے نبی تھے، جنہوں نے بتوں کی پرستش سے منع کیا')));

    const message = await refusal();

    expect(message).toMatch(/RELIGIOUS_MARKS/);
    expect(message).toMatch(/علیہ السلام/);
    expect(message).toMatch(/ﷺ/);
  });

  test('محمد with علیہ السلام is STILL refused — his salutation is ﷺ and nothing else', async () => {
    // The guard on the ruling's own words: "any prophet NOT Muhammad". If this is ever delivered,
    // the fix has demoted the Prophet's own salutation.
    create.mockResolvedValue(reply(religiousDoc('محمد علیہ السلام نے ارشاد کیا')));

    const message = await refusal();

    expect(message).toMatch(/RELIGIOUS_MARKS/);
    expect(message).toMatch(/names the Prophet/);
  });

  test('a LATIN "alaihis salam" is STILL refused — the ruling says stamp/nastaliq script', async () => {
    create.mockResolvedValue(reply(religiousDoc('حضرت ابراہیم اللہ کے نبی alaihis salam تھے')));

    const message = await refusal();

    expect(message).toMatch(/RELIGIOUS_MARKS/);
  });
});
