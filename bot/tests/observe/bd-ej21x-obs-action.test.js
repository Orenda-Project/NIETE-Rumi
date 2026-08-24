/**
 * bd-ej21x — "This observation" intermediate Flow screen (operator design,
 * 2026-08-24, follows bd-tju8f):
 *
 *   Tapping a worklist row no longer jumps straight into the chat handoff.
 *   With OBSERVE_OBS_ACTION=true (set only after the Flow JSON carrying the
 *   OBS_ACTION screen is republished — same deploy-order contract as
 *   OBSERVE_STAGE_SCREENS), the row opens OBS_ACTION: a server-fed
 *   NavigationList with exactly two rows —
 *     Continue → on-click-action 'complete' with the SAME payload the stage
 *                row used to carry (resume / debrief / send_report) — the
 *                chat handoff is byte-identical to today's;
 *     Cancel   → data_exchange step 'obs_cancel' → cancels IN-FLOW and lands
 *                on the data-driven SUCCESS screen (the visit-cancel pattern).
 *   This also closes the debrief-stage cancel gap: all three stages pass
 *   through the same screen, so cancel exists everywhere uniformly.
 *
 *   cancelObservationCore() is the extracted silent mutation (CAS +
 *   delivery-guard, NO chat sends) that both the Flow path and the legacy
 *   chat-button path call.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OBSERVE_SCHEDULING_UI = 'true';

const FORM_ROWS = [{ id: 'sess-form-1', created_at: '2026-08-22T09:00:00Z',
  teacher_name: 'Ayesha Karim', school_name: 'IMS G-7', resume: 'form',
  analysis_data: { teacher_delivery: { teacher_name: 'Ayesha Karim' } } }];
const PENDING = [{ id: 'sess-deb-1', created_at: '2026-08-22T10:00:00Z',
  teacher_name: 'Mehwish Raza', school_name: 'IMSG I-9',
  analysis_data: { teacher_delivery: { teacher_name: 'Mehwish Raza' } } }];
const UNSENT = [{ id: 'sess-send-1', created_at: '2026-08-22T11:00:00Z',
  teacher_name: 'Sara Bibi', school_name: 'IMSG I-9',
  analysis_data: { teacher_delivery: { teacher_name: 'Sara Bibi' } } }];

describe('bd-ej21x · OBS_ACTION screen', () => {
  let H;
  const mockCore = jest.fn(async () => ({ outcome: 'cancelled' }));

  beforeEach(() => {
    jest.resetModules();
    process.env.OBSERVE_OBS_ACTION = 'true';
    process.env.OBSERVE_STAGE_SCREENS = 'true';
    jest.doMock('../../shared/services/observe/observe-debrief.service', () => ({
      listPendingDebriefs: async () => PENDING,
      listUnsentReports: async () => UNSENT,
      listUnfinished: async () => FORM_ROWS,
    }), { virtual: true });
    jest.doMock('../../shared/services/observe/observe-resume.service', () => ({
      cancelObservationCore: mockCore,
    }), { virtual: true });
    mockCore.mockClear();
    H = require('../../shared/handlers/observe-visit-flow.handler');
  });
  afterEach(() => {
    jest.dontMock('../../shared/services/observe/observe-debrief.service');
    jest.dontMock('../../shared/services/observe/observe-resume.service');
    delete process.env.OBSERVE_OBS_ACTION;
  });

  const stageRows = async (step) =>
    (await H.handle('coach-1', 'data_exchange', 'MENU', { step }, 'coach-1', null)).data.items;

  it('flag ON: every stage row routes to obs_action via data_exchange, carrying session + stage', async () => {
    for (const [step, sid] of [['work_form', 'sess-form-1'], ['debriefs', 'sess-deb-1'], ['work_send', 'sess-send-1']]) {
      const row = (await stageRows(step)).find((r) => r.id === sid);
      expect(row['on-click-action'].name).toBe('data_exchange');
      expect(row['on-click-action'].payload).toMatchObject({ step: 'obs_action', session_id: sid, stage: step });
    }
  });

  it('flag OFF: rows keep the direct complete action (deploy-order safety)', async () => {
    delete process.env.OBSERVE_OBS_ACTION;
    jest.resetModules();
    H = require('../../shared/handlers/observe-visit-flow.handler');
    const row = (await stageRows('work_form')).find((r) => r.id === 'sess-form-1');
    expect(row['on-click-action'].name).toBe('complete');
    expect(row['on-click-action'].payload.observe_visit_action).toBe('resume');
  });

  it('obs_action returns the two-row screen: Continue completes with the legacy payload, Cancel data_exchanges', async () => {
    for (const [stage, sid, act] of [['work_form', 'sess-form-1', 'resume'],
      ['debriefs', 'sess-deb-1', 'debrief'], ['work_send', 'sess-send-1', 'send_report']]) {
      const out = await H.handle('coach-1', 'data_exchange', 'MENU',
        { step: 'obs_action', session_id: sid, stage }, 'coach-1', null);
      expect(out.screen).toBe('OBS_ACTION');
      const [cont, cancel] = out.data.items;
      expect(cont['on-click-action'].name).toBe('complete');
      expect(cont['on-click-action'].payload).toMatchObject({ observe_visit_action: act, session_id: sid });
      expect(cancel['on-click-action'].name).toBe('data_exchange');
      // one tap must NEVER cancel: the row goes to an in-flow confirm first
      expect(cancel['on-click-action'].payload).toMatchObject({ step: 'obs_cancel_confirm', session_id: sid, stage });
    }
  });

  it('obs_cancel_confirm re-renders OBS_ACTION as a yes/keep choice — yes cancels, keep goes back', async () => {
    const out = await H.handle('coach-1', 'data_exchange', 'MENU',
      { step: 'obs_cancel_confirm', session_id: 'sess-deb-1', stage: 'debriefs' }, 'coach-1', null);
    expect(out.screen).toBe('OBS_ACTION');
    expect(mockCore).not.toHaveBeenCalled();          // confirming is not cancelling
    const [yes, keep] = out.data.items;
    expect(yes['on-click-action'].name).toBe('data_exchange');
    expect(yes['on-click-action'].payload).toMatchObject({ step: 'obs_cancel', session_id: 'sess-deb-1' });
    expect(keep['on-click-action'].name).toBe('data_exchange');
    expect(keep['on-click-action'].payload).toMatchObject({ step: 'obs_action', session_id: 'sess-deb-1', stage: 'debriefs' });
  });

  it('a vanished session falls back to its stage list, never a dead screen', async () => {
    const out = await H.handle('coach-1', 'data_exchange', 'MENU',
      { step: 'obs_action', session_id: 'sess-gone', stage: 'debriefs' }, 'coach-1', null);
    expect(['DEBRIEFS', 'WORK_FORM', 'WORK_SEND']).toContain(out.screen);
  });

  it('obs_cancel cancels through the silent core and lands on the data-driven SUCCESS screen', async () => {
    const out = await H.handle('coach-1', 'data_exchange', 'MENU',
      { step: 'obs_cancel', session_id: 'sess-deb-1' }, 'coach-1', null);
    expect(mockCore).toHaveBeenCalledWith('sess-deb-1', expect.anything());
    expect(out.screen).toBe('SUCCESS');
    expect(out.data.action).toBe('cancelled');
  });

  it('a delivered report refuses in-flow cancel with the too-late body, and nothing is mutated twice', async () => {
    mockCore.mockResolvedValueOnce({ outcome: 'too_late' });
    const out = await H.handle('coach-1', 'data_exchange', 'MENU',
      { step: 'obs_cancel', session_id: 'sess-send-1' }, 'coach-1', null);
    expect(out.screen).toBe('SUCCESS');
    expect(out.data.action).toBe('noop');
  });
});

describe('bd-ej21x · back navigation from the new screens (the persistent-bug class)', () => {
  let H;
  beforeEach(() => {
    jest.resetModules();
    process.env.OBSERVE_OBS_ACTION = 'true';
    process.env.OBSERVE_STAGE_SCREENS = 'true';
    jest.doMock('../../shared/services/observe/observe-debrief.service', () => ({
      listPendingDebriefs: async () => PENDING,
      listUnsentReports: async () => UNSENT,
      listUnfinished: async () => FORM_ROWS,
    }), { virtual: true });
    H = require('../../shared/handlers/observe-visit-flow.handler');
  });
  afterEach(() => {
    jest.dontMock('../../shared/services/observe/observe-debrief.service');
    delete process.env.OBSERVE_OBS_ACTION;
  });

  it.each([['WORK_FORM'], ['WORK_SEND'], ['OBS_ACTION']])(
    'BACK from %s lands on a fresh MENU, never a dead screen', async (screen) => {
      const out = await H.handle('coach-1', 'BACK', screen, { v2: true }, 'coach-1', null);
      expect(out.screen).toBe('MENU');
      expect(Array.isArray(out.data.items)).toBe(true);
      expect(out.data.items.length).toBeGreaterThan(0);
    });
});

describe('bd-ej21x · cancelObservationCore (silent mutation)', () => {
  let updates;
  const mkRow = (over = {}) => ({ id: 'sess-1', status: 'observer_review_complete',
    observer_user_id: 'coach-1', user_id: 'coach-1', analysis_data: {}, ...over });
  let row;

  beforeEach(() => {
    jest.resetModules();
    updates = [];
    jest.doMock('../../shared/config/supabase', () => ({
      from: () => {
        const b = {
          select: () => b, in: () => b, order: () => b, limit: () => b,
          eq: () => b, or: () => b,
          single: () => Promise.resolve({ data: row, error: null }),
          maybeSingle: () => Promise.resolve({ data: row, error: null }),
          update: (payload) => { updates.push(payload); return b; },
          then: (res) => Promise.resolve({ data: row ? [row] : [], error: null }).then(res),
        };
        return b;
      },
    }));
    jest.doMock('../../shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn(async () => { throw new Error('core must never chat-send'); }),
      sendInteractiveButtons: jest.fn(async () => { throw new Error('core must never chat-send'); }),
    }));
  });
  afterEach(() => { jest.dontMock('../../shared/config/supabase'); jest.dontMock('../../shared/services/whatsapp.service'); });

  const core = () => require('../../shared/services/observe/observe-resume.service').cancelObservationCore;

  it('cancels an in-progress observation via CAS and reports cancelled', async () => {
    row = mkRow();
    const res = await core()('sess-1', { id: 'coach-1' });
    expect(res.outcome).toBe('cancelled');
    expect(updates).toEqual([{ status: 'cancelled' }]);
  });

  it('refuses once the report reached the teacher', async () => {
    row = mkRow({ analysis_data: { teacher_delivery: { status: 'sent' } } });
    const res = await core()('sess-1', { id: 'coach-1' });
    expect(res.outcome).toBe('too_late');
    expect(updates).toEqual([]);
  });

  it('an already-cancelled row is idempotent', async () => {
    row = mkRow({ status: 'cancelled' });
    const res = await core()('sess-1', { id: 'coach-1' });
    expect(res.outcome).toBe('already');
    expect(updates).toEqual([]);
  });
});
