/**
 * /status never shows a teacher an internal flow id, and a glance is not work.
 *
 * Two defects, both live on production when this was written (385 rows carrying
 * conversation_state: 197 `menu`, 182 `coaching`, 5 `attendance_marking`).
 *
 * 1. THE LABEL FALLBACK LEAKS THE ID. teacher-state.service did
 *
 *        const label = ConversationResume.TASK_LABEL[active.flow];
 *        const title = label ? label.en : active.flow;   // <-- the raw id
 *
 *    TASK_LABEL covers coaching/reading/video/quiz only, so every other flow on the
 *    store rendered as its own internal name: a principal mid-register saw
 *    "Continue: attendance_marking" / "Stop: attendance_marking". That is the exact
 *    thing conversation-resume.service's own header forbids — "Never show an
 *    internal id: 'lesson_plan' is our name for it, 'lesson plan' is hers."
 *
 * 2. A MENU GLANCE WAS LISTED AS WORK IN FLIGHT. The busy probe in this same file
 *    excludes `menu` deliberately (NOT_BUSY_FLOWS) and explains why: counting a
 *    glance as busy would defer a teacher's quiz report by an hour every time she
 *    opened the menu. listActiveResources had no such filter, so /status told 197
 *    production teachers they had "1 thing running" — the menu.
 *
 * WHAT IS DELIBERATELY *NOT* CHANGED HERE: offerability. TASK_LABEL is also the
 * `shouldOffer()` set, so adding entries to it would silently make attendance and
 * voice resumable — a product decision, not a display fix. Display and offerability
 * are therefore separated, and the last test pins that separation.
 */

function chainResolving(result) {
  const chain = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'not', 'gte', 'order', 'limit']) {
    chain[m] = jest.fn(() => chain);
  }
  chain.single = jest.fn().mockResolvedValue(result);
  chain.then = (resolve) => resolve(result);
  return chain;
}

function load({ activeState = null } = {}) {
  jest.resetModules();
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: jest.fn(() => chainResolving({ data: [], error: null })),
  }));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    isAvailable: () => false,
    redis: { get: jest.fn().mockResolvedValue(null), del: jest.fn() },
  }));
  jest.doMock('../../bot/shared/services/conversation-state.service', () => ({
    getState: jest.fn().mockResolvedValue(activeState),
    setState: jest.fn().mockResolvedValue(activeState),
    clearState: jest.fn().mockResolvedValue(true),
  }));
  return {
    TeacherState: require('../../bot/shared/services/teacher-state.service'),
    Resume: require('../../bot/shared/services/conversation-resume.service'),
  };
}

const state = (flow, step = 'x') => ({ flow, step, payload: {}, stack: [], version: 1 });

describe('/status never leaks an internal flow id', () => {
  // Every flow that writes to the store today. The raw id must not reach a teacher
  // for ANY of them — a new flow appearing here should fail this test, not ship a
  // mystery word to a principal.
  const FLOWS = [
    'coaching', 'reading', 'video', 'quiz',
    'lesson_plan', 'attendance_marking', 'attendance_method', 'attendance_voice',
  ];

  for (const flow of FLOWS) {
    it(`renders a human label for "${flow}", never the id`, async () => {
      const { TeacherState } = load({ activeState: state(flow) });
      const items = await TeacherState.listActiveResources('u-1');
      const pair = items.filter((i) => i.kind === 'flow_resume' || i.kind === 'flow_cancel');
      expect(pair.length).toBeGreaterThan(0);
      for (const it of pair) {
        expect(it.taskTitle).not.toBe(flow);          // not the bare id
        expect(it.taskTitle).not.toMatch(/_/);         // and not a snake_case leak
        expect(it.title).not.toMatch(/_/);
      }
    });
  }

  it('does NOT list a menu glance as work in flight', async () => {
    // The busy probe in this same file already decided a menu glance is not work.
    // /status has to agree with it, or 197 production teachers are told the menu is
    // a task they can "Stop".
    const { TeacherState } = load({ activeState: state('menu', 'AWAITING_MENU_CHOICE') });
    const items = await TeacherState.listActiveResources('u-1');
    expect(items.filter((i) => i.kind === 'flow_resume' || i.kind === 'flow_cancel')).toEqual([]);
  });

  it('still lists real work — the menu filter must not swallow everything', async () => {
    const { TeacherState } = load({ activeState: state('coaching', 'AWAITING_CLASSROOM_AUDIO') });
    const items = await TeacherState.listActiveResources('u-1');
    expect(items.filter((i) => i.kind === 'flow_resume')).toHaveLength(1);
    expect(items.find((i) => i.kind === 'flow_resume').taskTitle).toBe('classroom observation');
  });

  it('display is SEPARATE from offerability — labelling a flow must not make it resumable', async () => {
    // The guard on this fix: TASK_LABEL is shouldOffer()'s set. If a later edit adds
    // attendance/voice to it to fix the label, they silently become offerable, which
    // is a product decision (see the bead) and not this change.
    const { Resume } = load();
    expect(Resume.shouldOffer('attendance_marking')).toBe(false);
    expect(Resume.shouldOffer('attendance_voice')).toBe(false);
    expect(Resume.shouldOffer('lesson_plan')).toBe(false);
    expect(Resume.shouldOffer('coaching')).toBe(true);
  });
});
