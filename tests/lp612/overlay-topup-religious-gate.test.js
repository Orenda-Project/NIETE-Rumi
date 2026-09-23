/**
 * THE OVERLAY PATH COULD PUBLISH LLM-AUTHORED URDU WITHOUT EVER ASKING THE G5c GATE.
 *
 * `authorLessonPlan` refuses a document that still carries a `RELIGIOUS_MARKS` defect when the
 * round budget is spent (lp612-author.service.js, THE REFUSAL). `overlayLessonPlan` — the pass the
 * cache-repair lane drives — had two gates and neither of them was that one:
 *
 *   GATE 1  is it Urdu at all (a floor on the merge, plus a categorical check on this delta)
 *   GATE 2  coverage, from the linter's own `overlayDefects()` at `expected: true`
 *
 * `overlayDefects()` emits exactly ONE code, `OVERLAY_MISSING`. There is no religious code on that
 * path to trip, and `grep RELIGIOUS` over the two services that drive this pass
 * (`lp612-overlay-backfill`, `lp612-overlay-topup`) returns nothing. So a repair run translated
 * instruction strings with an LLM and handed the result back with no native-speaker hold anywhere
 * in the chain — and the strings it translates include `/provenance/chapter` and
 * `/provenance/topic`, the chapter and topic TITLES, which for Islamiyat, Urdu and Pak Studies are
 * exactly where a prophet or a companion gets named.
 *
 * Brief §4c, gate G5c: *"Automated checks do NOT clear religious content: the native-speaker review
 * remains a hard hold before any teacher delivery."* The lint says it in every message it emits.
 * Nothing on this path could refuse. Now it can.
 *
 * WHAT IS PINNED HERE:
 *
 *   • an overlay that names the Prophet with no honorific is REFUSED, by a throw — not a flag on
 *     the result. A flag changes nothing downstream: `lint_clean` is written to the render row and
 *     never read, so the lesson would send anyway (the same reasoning THE REFUSAL records);
 *   • an overlay that INTRODUCES religious content onto a document nobody flagged for review is
 *     refused too — that is the linter's check 6, the `needs_human_review` hold, and it is the
 *     protection that actually matters;
 *   • the same string WITH the ﷺ is accepted, so the gate refuses the defect and not the subject;
 *   • an ordinary non-religious overlay is untouched — the authoring path pays nothing for this.
 *
 * Red-first on f14000f7 (= origin/sandbox): every refusal below RESOLVES, and the offending Urdu
 * comes back in `out.overlay` ready to be written over a teacher's cached lesson.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { overlayDefects } = require(path.join(V, 'lint_lp.js'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const rawFixture = fs.readFileSync(BASE, 'utf8');

/** The stored document. `reviewed` is the native-speaker hold the linter's check 6 looks for. */
const doc = ({ reviewed = false } = {}) => {
  const d = JSON.parse(rawFixture);
  if (reviewed) d.needs_human_review = true;
  return d;
};

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
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { overlayLessonPlan } = require('../../bot/shared/services/lp612-author.service');

const reply = (obj) => ({
  choices: [{ message: { content: JSON.stringify(obj) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
});

const SEGMENT = {
  segment_id: 'grade_9_islamiyat.c03.p041-044', subject: 'Islamiyat', grade: 9,
};
const CORRELATION = 'overlay-religious-gate-unit-1';

/** Ordinary Urdu teacher instruction — no religious content anywhere in it. */
const PLAIN_UR = 'یہ ہدایت استاد کے لیے اردو میں لکھی گئی ہے۔';

/** A سیرت topic title that names the Prophet and DROPS the honorific. This is the defect. */
const UNHONORIFIED = 'سیرت کا سبق: نبی کریم کی زندگی';
/** The same title, written the way brief §4c.5 requires. */
const HONORIFIED = 'سیرت کا سبق: نبی کریم ﷺ کی زندگی';

/** A full-coverage overlay: every offered pointer in Urdu, with `/provenance/topic` swapped. */
function fullOverlay(d, topic) {
  const out = {};
  for (const ptr of overlayDefects.targets(d)) out[ptr] = PLAIN_UR;
  out['/provenance/topic'] = topic;
  return out;
}

const run = (d, extra = {}) => overlayLessonPlan({
  lpDoc: d, segment: SEGMENT, correlationId: CORRELATION, ...extra,
});

beforeEach(() => jest.clearAllMocks());

describe('GATE 3 — the overlay may not publish religious content the G5c review has not cleared', () => {
  test('THE RED TEST — an overlay naming the Prophet with no honorific is REFUSED', async () => {
    const d = doc({ reviewed: true });
    create.mockResolvedValue(reply(fullOverlay(d, UNHONORIFIED)));

    // On f14000f7 this RESOLVES: the pass returns the overlay and the caller writes it to R2.
    await expect(run(d)).rejects.toMatchObject({ code: 'OVERLAY_RELIGIOUS_MARKS' });
  });

  test('it THROWS rather than returning a flag — nothing downstream reads a flag', async () => {
    const d = doc({ reviewed: true });
    create.mockResolvedValue(reply(fullOverlay(d, UNHONORIFIED)));

    const out = await run(d).then((ok) => ({ resolved: ok }), (e) => ({ threw: e }));
    // The distinction THE REFUSAL records: `lint_clean` is written to the render row and never
    // consulted, so a `religiousClean: false` beside a returned overlay would send the lesson.
    expect(out.resolved).toBeUndefined();
    expect(out.threw.code).toBe('OVERLAY_RELIGIOUS_MARKS');
  });

  test('the refusal names the defect and carries the standing hold', async () => {
    const d = doc({ reviewed: true });
    create.mockResolvedValue(reply(fullOverlay(d, UNHONORIFIED)));

    const err = await run(d).catch((e) => e);
    expect(err.fails.some((f) => f.startsWith('RELIGIOUS_MARKS:'))).toBe(true);
    expect(err.fails.join('\n')).toMatch(/نبی کریم/);
    // Every finding this rule emits ends with gate G5c, and the operator reads the message.
    expect(err.message).toMatch(/native-speaker review/);
  });

  test('the refusal is logged to BOTH sinks, with the correlation and segment ids', async () => {
    const d = doc({ reviewed: true });
    create.mockResolvedValue(reply(fullOverlay(d, UNHONORIFIED)));

    await run(d).catch(() => {});
    const [name, payload] = logEvent.mock.calls.find(([n]) => /refused/.test(n)) || [];
    expect(name).toBe('lp612.overlay.refused');
    expect(payload).toMatchObject({
      correlationId: CORRELATION,
      segmentId: SEGMENT.segment_id,
      reason: 'religious_marks',
    });
  });

  test('an overlay that INTRODUCES religious content onto an unreviewed document is refused', async () => {
    // Check 6, the `needs_human_review` hold: the English document carried none of this, so
    // nobody ever asked for the review, and the Urdu page would be the first anyone saw of it.
    const d = doc();
    create.mockResolvedValue(reply(fullOverlay(d, HONORIFIED)));

    const err = await run(d).catch((e) => e);
    expect(err.code).toBe('OVERLAY_RELIGIOUS_MARKS');
    expect(err.message).toMatch(/needs_human_review/);
  });
});

describe('it refuses the DEFECT, not the subject', () => {
  test('the same سیرت title WITH the honorific is accepted on a reviewed document', async () => {
    const d = doc({ reviewed: true });
    create.mockResolvedValue(reply(fullOverlay(d, HONORIFIED)));

    const out = await run(d);
    expect(out.overlay['/provenance/topic']).toBe(HONORIFIED);
  });

  test('an ordinary non-religious overlay is untouched — the authoring path pays nothing', async () => {
    const d = doc();
    const plain = {};
    for (const ptr of overlayDefects.targets(d)) plain[ptr] = PLAIN_UR;
    create.mockResolvedValue(reply(plain));

    const out = await run(d);
    expect(Object.keys(out.overlay).length).toBeGreaterThan(50);
    expect(logEvent.mock.calls.filter(([n]) => /refused/.test(n))).toEqual([]);
  });
});

describe('the gate is measured on the MERGED document, not on this call', () => {
  test('a clean two-pointer top-up onto a base that already names the Prophet is refused', async () => {
    // What the gate protects is the page the teacher receives, which is the merge — the same
    // reason GATE 2 gives in its own comment. Judged on this call's slice alone, these two
    // strings are spotless and the lesson ships with the defect still on the page.
    const d = doc({ reviewed: true });
    const base = {};
    for (const ptr of overlayDefects.targets(d)) {
      if (ptr === '/provenance/topic' || ptr === '/provenance/chapter') continue;
      base[ptr] = PLAIN_UR;
    }
    base['/sections/1/blocks/0/text'] = UNHONORIFIED;
    create.mockResolvedValue(reply({
      '/provenance/topic': PLAIN_UR, '/provenance/chapter': PLAIN_UR,
    }));

    await expect(run(d, {
      targets: ['/provenance/topic', '/provenance/chapter'], baseOverlay: base,
    })).rejects.toMatchObject({ code: 'OVERLAY_RELIGIOUS_MARKS' });
  });
});
