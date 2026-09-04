'use strict';
/**
 * bd-wa5io — LP-selection list taps had NO list_reply routing: handleLPSelection
 * (the linker) was never called, so after picking an option the teacher got
 * nothing and the session hung at awaiting_lesson_plan.
 *
 * handleLpListSelection(listId, from, deps):
 *   lp_none_{sid}        → link none  → lessonPlan_skip msg   → queueAnalysis
 *   lp_upload_{sid}      → link uploaded → lessonPlan_request msg (doc handler continues)
 *   lp_select_{lp}_{sid} → link corpus ref → lessonPlan_linked msg → queueAnalysis
 *   anything else        → returns false, does nothing
 */
const { handleLpListSelection } = require('../../bot/shared/services/coaching/lp-coaching/lp-list-selection.handler');

const SID = '3a46f37d-0000-0000-0000-000000000000';

function deps(linkResult) {
  const sent = [];
  const queued = [];
  const linked = [];
  return {
    sent, queued, linked,
    linker: { handleLPSelection: async (sessionId, selectionId) => { linked.push({ sessionId, selectionId }); return linkResult; } },
    sendMessage: async (to, text) => { sent.push({ to, text }); },
    queueAnalysis: async (sessionId, payload) => { queued.push({ sessionId, payload }); },
    resolveLanguage: async () => 'ur',
    // Injected so the test never touches the default supabase lookup (a network call that hangs on some machines).
    sessionStatus: async () => 'awaiting_lesson_plan',
  };
}

describe('handleLpListSelection (bd-wa5io)', () => {
  test('lp_none_: links none, tells the teacher, queues analysis', async () => {
    const d = deps({ lesson_plan_link_method: 'none', awaiting_upload: false });
    const handled = await handleLpListSelection(`lp_none_${SID}`, '92336', d);
    expect(handled).toBe(true);
    expect(d.linked[0]).toEqual({ sessionId: SID, selectionId: `lp_none_${SID}` });
    expect(d.sent).toHaveLength(1);
    expect(d.queued).toEqual([{ sessionId: SID, payload: { from: '92336' } }]);
  });

  test('lp_upload_: links uploaded, asks for the document, does NOT queue analysis', async () => {
    const d = deps({ lesson_plan_link_method: 'uploaded', awaiting_upload: true });
    const handled = await handleLpListSelection(`lp_upload_${SID}`, '92336', d);
    expect(handled).toBe(true);
    expect(d.sent).toHaveLength(1);
    expect(d.queued).toHaveLength(0); // the document handler queues after the upload arrives
  });

  test('lp_select_: links the corpus LP, confirms, queues analysis', async () => {
    const d = deps({ lesson_plan_link_method: 'selected_recent', awaiting_upload: false, fidelity_ref: { lesson_id: 'g3m1' } });
    const handled = await handleLpListSelection(`lp_select_abcd-123_${SID}`, '92336', d);
    expect(handled).toBe(true);
    expect(d.linked[0].selectionId).toBe(`lp_select_abcd-123_${SID}`);
    expect(d.sent).toHaveLength(1);
    expect(d.queued).toEqual([{ sessionId: SID, payload: { from: '92336' } }]);
  });

  test('non-lp ids are not handled (returns false, touches nothing)', async () => {
    const d = deps({});
    expect(await handleLpListSelection('vq_answer_1', '92336', d)).toBe(false);
    expect(await handleLpListSelection('training_quiz_x', '92336', d)).toBe(false);
    expect(d.linked).toHaveLength(0);
    expect(d.sent).toHaveLength(0);
  });

  test('a linker throw does not leave the teacher silent — an apology/skip still goes out', async () => {
    const d = deps({});
    d.linker.handleLPSelection = async () => { throw new Error('db down'); };
    const handled = await handleLpListSelection(`lp_none_${SID}`, '92336', d);
    expect(handled).toBe(true);
    expect(d.sent.length).toBeGreaterThanOrEqual(1); // teacher hears SOMETHING
  });
});

/**
 * bd-5knlj — a late tap (the session already analyzed) used to re-queue a full
 * analysis or do nothing useful; now it recomputes ONLY the fidelity section,
 * while a pre-analysis tap keeps the original queueAnalysis continuation.
 */
describe('late LP selection → fidelity recompute (bd-5knlj)', () => {
  const { handleLpListSelection } = require('../../bot/shared/services/coaching/lp-coaching/lp-list-selection.handler');

  function lateDeps(status) {
    const calls = { queued: 0, recomputed: 0, sent: [] };
    return {
      calls,
      deps: {
        linker: { handleLPSelection: async () => ({ lesson_plan_link_method: 'selected_recent' }) },
        sendMessage: async (to, text) => { calls.sent.push(text); },
        queueAnalysis: async () => { calls.queued += 1; },
        recomputeFidelity: async () => { calls.recomputed += 1; return { recomputed: true }; },
        sessionStatus: async () => status,
        resolveLanguage: async () => 'en',
        messages: { getCoachingMessage: (k) => k },
      },
    };
  }

  it('a tap on an already-analyzed session recomputes fidelity instead of re-running analysis', async () => {
    const { deps, calls } = lateDeps('awaiting_observer_review');
    await handleLpListSelection('lp_select_asset1_11111111-1111-1111-1111-111111111111', '92300', deps);
    expect(calls.recomputed).toBe(1);
    expect(calls.queued).toBe(0);
  });

  it('a tap at the LP step keeps the original continuation', async () => {
    const { deps, calls } = lateDeps('awaiting_lesson_plan');
    await handleLpListSelection('lp_select_asset1_11111111-1111-1111-1111-111111111111', '92300', deps);
    expect(calls.queued).toBe(1);
    expect(calls.recomputed).toBe(0);
  });
});

/**
 * bd-2kxxa.4 — the "which lesson plan?" list stays in the chat. A tap AFTER the
 * observer's review was submitted used to: write the new _fidelity_ref, tell the
 * coach "linked", then have the fidelity recompute refuse silently
 * (review_submitted) and the handler discard that result — "linked", and nothing
 * changed. Now the status is checked FIRST: a submitted session gets an honest
 * reply and NO write; an open one is told "linked" only after the linker ran.
 */
describe('late re-selection is honest (bd-2kxxa.4)', () => {
  const { handleLpListSelection } = require('../../bot/shared/services/coaching/lp-coaching/lp-list-selection.handler');
  const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');
  const TAP = 'lp_select_asset1_11111111-1111-1111-1111-111111111111';

  function build(status, recomputeResult = { recomputed: true }) {
    const calls = { linked: 0, recomputed: 0, queued: 0, sent: [], order: [] };
    return {
      calls,
      deps: {
        linker: {
          handleLPSelection: async () => {
            calls.linked += 1; calls.order.push('link');
            return { lesson_plan_link_method: 'selected_recent', fidelity_ref: { lesson_id: 'B' } };
          },
        },
        sendMessage: async (to, text) => { calls.sent.push(text); calls.order.push(`send:${text}`); },
        queueAnalysis: async () => { calls.queued += 1; },
        recomputeFidelity: async () => { calls.recomputed += 1; calls.order.push('recompute'); return recomputeResult; },
        sessionStatus: async () => status,
        resolveLanguage: async () => 'en',
        messages: { getCoachingMessage: (k) => k },
      },
    };
  }

  it.each(['observer_review_complete', 'completed', 'cancelled'])(
    'T1 status=%s: linker NOT called, honest reply, "linked" NOT sent',
    async (status) => {
      const { deps, calls } = build(status);
      expect(await handleLpListSelection(TAP, '92300', deps)).toBe(true);
      expect(calls.linked).toBe(0);      // no _fidelity_ref write on a submitted review
      expect(calls.recomputed).toBe(0);
      expect(calls.queued).toBe(0);
      expect(calls.sent).toEqual(['lessonPlan_review_submitted']);
    },
  );

  it('T2 status=awaiting_observer_review: links, says "linked" only AFTER the linker, recomputes', async () => {
    const { deps, calls } = build('awaiting_observer_review');
    expect(await handleLpListSelection(TAP, '92300', deps)).toBe(true);
    expect(calls.linked).toBe(1);
    expect(calls.recomputed).toBe(1);
    expect(calls.queued).toBe(0);
    expect(calls.sent).toEqual(['lessonPlan_linked']);
    expect(calls.order).toEqual(['link', 'send:lessonPlan_linked', 'recompute']);
  });

  it('race: submitted between the status check and the write → the honest reply still goes out', async () => {
    const { deps, calls } = build('awaiting_observer_review', { recomputed: false, reason: 'review_submitted' });
    await handleLpListSelection(TAP, '92300', deps);
    expect(calls.sent[calls.sent.length - 1]).toBe('lessonPlan_review_submitted');
  });

  it('the honest string is catalogued in en AND ur — never an inline literal', () => {
    expect(getCoachingMessage('lessonPlan_review_submitted', 'en'))
      .toBe("This observation's review has already been submitted, so I can't change its lesson plan.");
    const ur = getCoachingMessage('lessonPlan_review_submitted', 'ur');
    expect(ur).not.toBe(getCoachingMessage('lessonPlan_review_submitted', 'en'));
    expect(ur).toMatch(/[؀-ۿ]/); // a real Urdu translation, not the English fallback
  });
});
