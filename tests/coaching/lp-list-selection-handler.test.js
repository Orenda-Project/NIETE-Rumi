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
