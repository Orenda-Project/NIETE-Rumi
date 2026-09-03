/**
 * bd-wwcgf — the TEACHER received the coach's editable FICO draft form.
 *
 * Live incident (Rifat, 3 Sep 2026 — teacher Saima Mustafa, EMIS 221, traced
 * end-to-end in niete-logs corr-1788411164931-7ypmtmg9j):
 *   04:47 the teacher starts her own DC self-serve session.
 *   04:49 coach Mubashar starts a leader observation OF HER (session 6e035f61,
 *         user_id = teacher, observer_user_id = coach).
 *   04:51 the teacher texts → resendLpPromptIfWaiting matches the OBSERVE
 *         session via its `user_id.eq` arm (added for the coach's LP photo in
 *         bd-9hzdn.2, over-reaching here) and serves HER the LP list bound to
 *         the coach's session (listId lp_select_…_6e035f61).
 *   04:52 she picks an LP → analysis queued with from = HER phone.
 *   04:54 onAnalysisReady(sessionId, from) sends the editable observer Flow
 *         to `from` — the teacher — while arming state on the observer.
 *
 * Two defects, one contract each:
 *  1. A user's inbound message may only resume a session they DRIVE: their own
 *     self-serve session, or an observation they are the OBSERVER on. Being
 *     the observed teacher on a leader_observation row is not ownership. The
 *     shared predicate is session-ownership.js and it gates the lp-step text
 *     hook AND the R165 media-session-resolver (photos, LPs, race holds).
 *  2. Observer-facing sends derive the recipient from the SESSION ROW
 *     (observer_user_id → users.phone_number), never from the message `from`
 *     that happened to trigger the pipeline stage — the same principle the
 *     service header already states for observe-ness itself.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const TEACHER = { id: 'teacher-1' };
const COACH = { id: 'coach-1' };

// The observe session as it stood at 04:51 — teacher is user_id, coach observes.
const OBSERVE_ROW = () => ({
  id: 'obs-sess-1',
  user_id: 'teacher-1',
  observer_user_id: 'coach-1',
  observation_type: 'leader_observation',
  status: 'awaiting_lesson_plan',
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  conversation_state: { current_state: 'AWAITING_LESSON_PLAN' },
});

describe('bd-wwcgf · session-ownership predicate (the shared rule all matchers use)', () => {
  const { drivesSession, firstDrivenSession } = require('../../shared/services/coaching/session-ownership');
  const OBS = { user_id: 'teacher-1', observer_user_id: 'coach-1', observation_type: 'leader_observation' };
  const SELF = { user_id: 'teacher-1', observer_user_id: null, observation_type: null };

  it('the observed teacher does NOT drive a leader observation of her', () => {
    expect(drivesSession('teacher-1', OBS)).toBe(false);
  });
  it('the observer drives it', () => {
    expect(drivesSession('coach-1', OBS)).toBe(true);
  });
  it('a teacher drives her own self-serve session', () => {
    expect(drivesSession('teacher-1', SELF)).toBe(true);
  });
  it('a third party drives neither', () => {
    expect(drivesSession('someone-else', OBS)).toBe(false);
    expect(drivesSession('someone-else', SELF)).toBe(false);
  });
  it('firstDrivenSession skips the observe row and finds her own session behind it', () => {
    expect(firstDrivenSession('teacher-1', [OBS, SELF])).toBe(SELF);
    expect(firstDrivenSession('teacher-1', [OBS])).toBe(null);
    expect(firstDrivenSession('coach-1', [OBS, SELF])).toBe(OBS);
  });
});

describe('bd-wwcgf defect 1a · resendLpPromptIfWaiting must not let the observed teacher hijack the observe session', () => {
  const sent = [];
  let lpQueryRows;

  beforeEach(() => {
    jest.resetModules();
    sent.length = 0;
    lpQueryRows = [OBSERVE_ROW()];
    jest.doMock('../../shared/config/supabase', () => ({
      from: (table) => {
        const b = { _table: table, _byId: false };
        b.select = () => b;
        b.or = () => b;
        b.eq = (col) => { if (col === 'id') b._byId = true; return b; };
        b.order = () => b;
        b.limit = () => b;
        b.update = () => b;
        b.maybeSingle = async () => {
          if (table === 'users') return { data: { preferred_language: 'ur', region: null }, error: null };
          return { data: lpQueryRows[0] || null, error: null };
        };
        // thenable: awaiting the builder (list query) resolves the row list
        b.then = (resolve) => resolve({ data: lpQueryRows, error: null });
        return b;
      },
    }));
    jest.doMock('../../shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn(async () => true),
      sendInteractiveMessage: jest.fn(async (to, p) => { sent.push({ to, p }); return true; }),
      sendInteractiveButtons: jest.fn(async (to, p) => { sent.push({ to, p }); return true; }),
    }));
  });
  afterEach(() => jest.resetModules());

  it("the observed TEACHER's text does NOT resume the coach's observe session", async () => {
    const { resendLpPromptIfWaiting } = require('../../shared/services/coaching/lp-coaching/lp-step.service');
    const consumed = await resendLpPromptIfWaiting(TEACHER, '923155205294');
    expect(consumed).toBe(false);   // her text falls through to her own flow
    expect(sent.length).toBe(0);    // no LP list bound to the observe session
  });

  it("the OBSERVER's text still resumes it (bd-9hzdn.2 behavior preserved)", async () => {
    const { resendLpPromptIfWaiting } = require('../../shared/services/coaching/lp-coaching/lp-step.service');
    const consumed = await resendLpPromptIfWaiting(COACH, '923268124128');
    expect(consumed).toBe(true);
    expect(sent.length).toBe(1);
  });

  it('a plain self-serve session still resumes for its own teacher', async () => {
    lpQueryRows = [{
      ...OBSERVE_ROW(), observation_type: null, observer_user_id: null,
    }];
    const { resendLpPromptIfWaiting } = require('../../shared/services/coaching/lp-coaching/lp-step.service');
    const consumed = await resendLpPromptIfWaiting(TEACHER, '923155205294');
    expect(consumed).toBe(true);
    expect(sent.length).toBe(1);
  });
});

describe('bd-wwcgf defect 1b · media-session-resolver (R165) never hands the observed teacher the observe session', () => {
  let rows;
  beforeEach(() => {
    jest.resetModules();
    rows = [OBSERVE_ROW()];
    jest.doMock('../../shared/services/coaching/media-target.service', () => ({
      getTarget: jest.fn(async () => null),
      clearTarget: jest.fn(async () => true),
    }));
    jest.doMock('../../shared/config/supabase', () => ({
      from: () => {
        const b = {};
        b.select = () => b; b.or = () => b; b.in = () => b; b.order = () => b; b.eq = () => b;
        b.maybeSingle = async () => ({ data: rows[0] || null, error: null });
        b.then = (resolve) => resolve({ data: rows, error: null });
        return b;
      },
    }));
  });
  afterEach(() => jest.resetModules());

  it("the TEACHER's LP media does not resolve to the coach's observe session (outcome none)", async () => {
    const { resolveMediaSession } = require('../../shared/services/coaching/media-session-resolver');
    const r = await resolveMediaSession({ user: TEACHER, kind: 'lp' });
    expect(r.outcome).toBe('none');
    expect(r.session).toBe(null);
  });

  it("the COACH's LP media still resolves to it (outcome single)", async () => {
    const { resolveMediaSession } = require('../../shared/services/coaching/media-session-resolver');
    const r = await resolveMediaSession({ user: COACH, kind: 'lp' });
    expect(r.outcome).toBe('single');
    expect(r.session.id).toBe('obs-sess-1');
  });

  it("the TEACHER's photo prefers her own session even when the observe session is newer", async () => {
    rows = [OBSERVE_ROW(), {
      id: 'self-sess-1', user_id: 'teacher-1', observer_user_id: null, observation_type: null,
      status: 'awaiting_classroom_photo', created_at: new Date(Date.now() - 60000).toISOString(),
      conversation_state: { current_state: 'AWAITING_LESSON_PLAN' },
    }];
    const { resolveMediaSession } = require('../../shared/services/coaching/media-session-resolver');
    const r = await resolveMediaSession({ user: TEACHER, kind: 'lp' });
    // the observe row is filtered out entirely — only her own session remains
    expect(r.candidates.every((s) => s.id !== 'obs-sess-1')).toBe(true);
  });
});

describe('bd-wwcgf defect 2 · onAnalysisReady sends the editable form to the OBSERVER, not to `from`', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn(async () => true),
      sendFlow: jest.fn(async () => true),
    }));
    jest.doMock('../../shared/services/observe/observe-state.service', () => ({
      setState: jest.fn(async () => true),
      getState: jest.fn(async () => null),
      clearState: jest.fn(async () => true),
    }));
    jest.doMock('../../shared/config/supabase', () => ({
      from: jest.fn((table) => ({
        _table: table,
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn(() => ({ eq: jest.fn(async () => ({ data: null, error: null })) })),
        single: jest.fn(async () => (table === 'coaching_sessions'
          ? {
              data: {
                id: 'obs-sess-1', user_id: 'teacher-1', observer_user_id: 'coach-1',
                observation_type: 'leader_observation', debrief_status: 'pending',
                analysis_data: { framework: 'fico', domains: {} }, autofill_analysis_data: null,
                // users!inner join rides user_id → this is the TEACHER's phone
                users: { phone_number: '923155205294', first_name: 'Saima', preferred_language: 'ur' },
              },
              error: null,
            }
          : { data: null, error: null })),
        maybeSingle: jest.fn(async () => (table === 'users'
          ? { data: { phone_number: '923268124128' }, error: null }   // the OBSERVER's phone
          : { data: null, error: null })),
      })),
    }));
    process.env.OBSERVE_MEWAKA_FLOW_ID = '1076869101587489';
  });
  afterEach(() => jest.resetModules());

  it('the flow goes to the observer phone from the session row, even when `from` is the teacher', async () => {
    const WhatsAppService = require('../../shared/services/whatsapp.service');
    const ObserveDraft = require('../../shared/services/observe/observe-draft.service');
    // `from` = the teacher (she triggered the analysis stage) — the incident shape
    await ObserveDraft.onAnalysisReady('obs-sess-1', '923155205294');
    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
    const [to] = WhatsAppService.sendFlow.mock.calls[0];
    expect(to).toBe('923268124128');
  });

  it('the text fallback (no flow id) also goes to the observer', async () => {
    process.env.OBSERVE_MEWAKA_FLOW_ID = '';
    const WhatsAppService = require('../../shared/services/whatsapp.service');
    const ObserveDraft = require('../../shared/services/observe/observe-draft.service');
    await ObserveDraft.onAnalysisReady('obs-sess-1', '923155205294');
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage.mock.calls[0][0]).toBe('923268124128');
  });
});

describe('bd-wwcgf · wiring — the resolver and the lp-step hook stay on the predicate', () => {
  const fs = require('fs');
  const path = require('path');
  const RESOLVER = fs.readFileSync(path.join(__dirname, '../../shared/services/coaching/media-session-resolver.js'), 'utf8');
  const LP_STEP = fs.readFileSync(path.join(__dirname, '../../shared/services/coaching/lp-coaching/lp-step.service.js'), 'utf8');

  it('SESSION_COLUMNS carries observation_type so the predicate always has its input', () => {
    expect(RESOLVER).toMatch(/SESSION_COLUMNS = '[^']*observation_type/);
  });
  it('the resolver filters candidates through drivesSession', () => {
    expect(RESOLVER).toMatch(/drivesSession\(userId, s\)/);
  });
  it('the lp-step text hook selects observation_type and filters via firstDrivenSession', () => {
    expect(LP_STEP).toMatch(/observation_type/);
    expect(LP_STEP).toMatch(/firstDrivenSession/);
  });
});
