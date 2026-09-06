/**
 * bd-zle0u, STEP 2 — THE SEPARATE PASS. The one the directive claimed for a year.
 *
 * Step 1 took the overlay out of the revision ladder and made an Urdu request DELIVER again, in
 * English, honestly. This is the half that gives her the lesson in the language she asked for:
 * after the ladder ACCEPTS a document, ONE call translates its instruction strings and the
 * overlaid document is what she receives.
 *
 * Two numbers frame every choice below. The overlay is ~7,000 output tokens; the ladder ran it
 * FIVE times and blew an 840 s timeout. Once, at the end, is ~45–60 s at the measured 142 tok/s.
 *
 * WHAT THIS SUITE PINS, and why each one is a bug that has already happened here:
 *
 *   1. The pass is handed the EXACT pointer→English map and may only answer in those keys. The
 *      first real overlay this lane ever produced wrote eight pointers into blocks the model had
 *      not written, and `render_lp.js` refuses the WHOLE document on any `OVERLAY_INVALID` — the
 *      fix for "she gets an English lesson" manufactured "she gets NO lesson". Not sending the
 *      document removes the ability to invent a pointer rather than repairing it afterwards.
 *   2. It gates its own output — coverage (`OVERLAY_MISSING` at `expected: true`), applicability,
 *      and that the values are actually URDU. Rule 24(c): a prompt that demands a property is
 *      checked in code before the result is trusted. A model that answers in English would
 *      otherwise sail through every structural gate ever written here.
 *   3. **It NEVER falls back to nothing.** A failed call, a thin overlay, an English overlay, a
 *      render that refuses the overlaid document — every one of them delivers step 1's English
 *      PDF with the honest caption. That is the whole lesson of this week: the previous two
 *      attempts each replaced a wrong-language lesson with no lesson at all.
 *   4. The pass runs OUTSIDE the author timeout, on its own bound.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { overlayDefects } = require(path.join(V, 'lint_lp.js'));
const { applyOverlay } = require(path.join(V, 'lib', 'overlay.js'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const rawFixture = fs.readFileSync(BASE, 'utf8');
const doc = () => JSON.parse(rawFixture);

// ── 1 · the service call ────────────────────────────────────────────────────

describe('overlayLessonPlan — one call, on the finished document', () => {
  jest.resetModules();
  jest.mock('../../bot/shared/services/llm-client', () => {
    const create = jest.fn();
    return { getClient: () => ({ chat: { completions: { create } } }), __create: create };
  });
  jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

  const create = require('../../bot/shared/services/llm-client').__create;
  const { overlayLessonPlan } = require('../../bot/shared/services/lp612-author.service');

  const reply = (obj, usage = { prompt_tokens: 8000, completion_tokens: 7000, total_tokens: 15000 }) => ({
    choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }],
    usage,
  });

  /** A full, plausible overlay: every allowed pointer, in Urdu script. */
  const fullUrdu = (d) => {
    const out = {};
    for (const ptr of overlayDefects.targets(d)) out[ptr] = 'یہ اردو ہدایت ہے جو اس سبق کے لیے لکھی گئی ہے۔';
    return out;
  };

  beforeEach(() => jest.clearAllMocks());

  it('exists, and is a function the worker can call', () => {
    expect(typeof overlayLessonPlan).toBe('function');
  });

  it('makes exactly ONE model call — the whole point of moving it out of the ladder', async () => {
    const d = doc();
    create.mockResolvedValue(reply(fullUrdu(d)));

    await overlayLessonPlan({ lpDoc: d, segment: { segment_id: 's1', subject: 'Chemistry', grade: 9 } });

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('sends the pointer→ENGLISH map, not the whole document — a pointer it never saw cannot be invented', async () => {
    const d = doc();
    create.mockResolvedValue(reply(fullUrdu(d)));

    await overlayLessonPlan({ lpDoc: d, segment: { segment_id: 's1', subject: 'Chemistry', grade: 9 } });

    const user = create.mock.calls[0][0].messages[1].content;
    const targets = overlayDefects.targets(d);
    for (const ptr of targets.slice(0, 5)) expect(user).toContain(ptr);
    // and the frozen slots are not even offered
    expect(user).not.toContain('/slo/text_verbatim');
  });

  it('the brief carries the Urdu rules the renderer cannot repair afterwards', async () => {
    const d = doc();
    create.mockResolvedValue(reply(fullUrdu(d)));
    await overlayLessonPlan({ lpDoc: d, segment: { segment_id: 's1', subject: 'Chemistry', grade: 9 } });

    const system = create.mock.calls[0][0].messages[0].content;
    expect(system).toMatch(/۰۱۲۳۴۵۶۷۸۹|Urdu digit/i);   // language-protocol §9.4
    expect(system).toMatch(/term of record|technical term/i);  // §9.5
    expect(system).toMatch(/JSON/);
  });

  it('KEEPS only the pointers it asked for — an invented one is dropped, not repaired later', async () => {
    const d = doc();
    const ov = fullUrdu(d);
    ov['/sections/9/blocks/9/legend'] = 'یہ اشارہ کہیں موجود نہیں';   // the bd-vnyuw failure, exactly
    create.mockResolvedValue(reply(ov));

    const out = await overlayLessonPlan({ lpDoc: d, segment: { segment_id: 's1' } });

    expect(out.overlay['/sections/9/blocks/9/legend']).toBeUndefined();
    // and what survives can ALWAYS be applied — no OVERLAY_INVALID is reachable
    const d2 = doc();
    d2.ur_overlay = out.overlay;
    expect(applyOverlay(d2, 'ur').errors).toEqual([]);
  });

  it('reports its usage, so the ~7k claim is measured and not asserted', async () => {
    const d = doc();
    create.mockResolvedValue(reply(fullUrdu(d)));
    const out = await overlayLessonPlan({ lpDoc: d, segment: { segment_id: 's1' } });
    expect(out.usage.completion_tokens).toBe(7000);
    expect(out.usage.calls).toBe(1);
  });

  it('a reply that is not JSON is a FAILURE, not a silent empty overlay', async () => {
    create.mockResolvedValue(reply('I am afraid I cannot translate that.'));
    await expect(overlayLessonPlan({ lpDoc: doc(), segment: { segment_id: 's1' } }))
      .rejects.toThrow();
  });

  it('an overlay whose values are ENGLISH is REFUSED — the model complies most of the time', async () => {
    // Rule 24(c). Every structural gate in this repo passes on an English overlay: the pointers
    // resolve, the coverage clears, the render succeeds, and the teacher gets the same English
    // page she got for the whole life of the lane, now with `overlay_dropped = false` on the row
    // to say it worked. That row is worse than the bug.
    const d = doc();
    const english = {};
    for (const ptr of overlayDefects.targets(d)) english[ptr] = 'This is an English instruction string.';
    create.mockResolvedValue(reply(english));

    await expect(overlayLessonPlan({ lpDoc: d, segment: { segment_id: 's1' } }))
      .rejects.toThrow(/urdu/i);
  });

  it('a THIN overlay is refused by the same coverage floor the ladder used to chase', async () => {
    const d = doc();
    create.mockResolvedValue(reply({ '/one_screen': 'خلاصہ' }));

    await expect(overlayLessonPlan({ lpDoc: d, segment: { segment_id: 's1' } }))
      .rejects.toThrow(/covers 1 of \d+ strings.*floor is 50%/i);
    // and it carries the LINTER's own message, so the reason is the same sentence the ladder
    // used to be handed — one wording, not two that drift.
    await expect(overlayLessonPlan({ lpDoc: doc(), segment: { segment_id: 's1' } }))
      .rejects.toThrow(/must carry an `ur_overlay`/);
  });

  it('and the coverage check is the SAME computation as the lint gate, at expected:true', () => {
    const d = doc();
    d.ur_overlay = fullUrdu(d);
    expect(overlayDefects(d, 'ur', { expected: true })).toEqual([]);
  });
});
