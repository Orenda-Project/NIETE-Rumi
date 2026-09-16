/**
 * A cancelled observation was revived by a button from ten seconds earlier.
 *
 * Staging, 15 Sep 2026, observation d2163959:
 *   22:16:14Z  the photo gate goes out (transcription finished)
 *   22:16:25Z  the coach cancels        → status 'cancelled'
 *   22:17:10Z  the coach taps that gate's "No" → 📸 User declined classroom photo
 *              → status 'awaiting_lesson_plan', and the bot asks for a lesson plan
 *
 * The cancel guard added for the FICO form endpoint covers that endpoint only.
 * Every other path resolves its own session from the id inside the button (or the
 * job) and wrote without reading `status`.
 *
 * Every case here executes the real handler with only the database and WhatsApp
 * mocked, one per entry point.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OBSERVE_FRAMEWORK = 'fico';

const { resolveUx } = require('../../shared/config/ux-strings');
const { TERMINAL_IN_FILTER } = require('../../shared/services/coaching/session-terminal');

const SID = 'obs-cancelled-1';
const COACH = { id: 'coach-1', phone_number: '923000000001', preferred_language: 'en' };
const FROM = COACH.phone_number;
const CANCELLED = 'This session was cancelled';

/** A session row, cancelled unless told otherwise. */
function row(status = 'cancelled', extra = {}) {
  return {
    id: SID,
    status,
    user_id: 'teacher-1',
    observer_user_id: COACH.id,
    observation_type: 'leader_observation',
    debrief_status: 'pending',
    transcript_text: 'a transcript',
    audio_id: 'media-1',
    analysis_data: {},
    autofill_analysis_data: null,
    conversation_state: { current_state: 'AWAITING_PHOTO' },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    questions_answered: 1,
    users: { name: null, phone_number: '923000000009', preferred_language: 'en' },
    ...extra,
  };
}

/**
 * Chainable supabase double. Records every update payload and every
 * `.not(...)` applied, so a write predicate is observable.
 */
function db(session, { users = [COACH] } = {}) {
  const calls = { updates: [], nots: [], selects: [] };
  const api = {
    calls,
    from(table) {
      const b = { filters: {}, _update: null };
      ['select', 'order', 'limit', 'in', 'or', 'is', 'gte', 'lte', 'range'].forEach((m) => {
        b[m] = (...a) => {
          if (m === 'select') calls.selects.push({ table, a });
          // A paged read answers with a LIST, which its caller spreads.
          if (m === 'range' || m === 'limit') b._many = true;
          return b;
        };
      });
      b.eq = (c, v) => { b.filters[c] = v; return b; };
      b.neq = () => b;
      b.not = (col, op, val) => { calls.nots.push({ table, col, op, val }); b._notTerminal = (col === 'status' && String(val) === TERMINAL_IN_FILTER); return b; };
      b.update = (fields) => { b._update = fields; calls.updates.push({ table, fields }); return b; };
      const rows = () => {
        if (table === 'coaching_sessions') {
          // A write predicated on a non-terminal status matches nothing here.
          if (b._update && b._notTerminal && ['cancelled', 'abandoned'].includes(session.status)) return { data: [], error: null };
          // A write that DID match answers .select('id') with rows, as PostgREST does.
          if (b._update) return { data: [{ id: session.id }], error: null };
          return { data: b._many ? [session] : session, error: null };
        }
        if (table === 'users') {
          const [[c, v] = []] = Object.entries(b.filters);
          return { data: users.find((u) => u[c] === v) || null, error: null };
        }
        return { data: null, error: null };
      };
      b.single = async () => rows();
      b.maybeSingle = async () => rows();
      b.then = (ok, ko) => Promise.resolve(rows()).then(ok, ko);
      return b;
    },
  };
  return api;
}

function wa(sent) {
  return {
    sendMessage: jest.fn(async (to, text) => { sent.push({ kind: 'text', to, text }); return true; }),
    sendInteractiveButtons: jest.fn(async (to, p) => { sent.push({ kind: 'buttons', to, p }); return true; }),
    sendInteractiveMessage: jest.fn(async (to, p) => { sent.push({ kind: 'list', to, p }); return true; }),
    sendFlow: jest.fn(async (to, f) => { sent.push({ kind: 'flow', to, f }); return true; }),
    sendImageFromBuffer: jest.fn(async () => true),
  };
}

const refusal = resolveUx('coachingSessionCancelled', { language: 'en' });

describe('the photo gate → lesson-plan step (the tap in the incident)', () => {
  let sent; let store;

  function load(status) {
    jest.resetModules();
    sent = []; store = db(row(status));
    jest.doMock('../../shared/config/supabase', () => store);
    jest.doMock('../../shared/services/whatsapp.service', () => wa(sent));
    jest.doMock('../../shared/services/coaching/lp-coaching/send-lp-prompt', () => ({
      sendLpPrompt: jest.fn(async (WA, to, p) => { sent.push({ kind: 'lp_prompt', to, p }); return true; }),
    }));
    jest.doMock('../../shared/services/coaching/lp-coaching/lp-selection-list.service', () => ({
      buildLPSelectionList: jest.fn(() => ({ body: 'pick an LP' })),
    }));
    jest.doMock('../../shared/services/coaching/fidelity/fidelity-orchestrator', () => ({ isFidelityEnabled: () => false }));
    return require('../../shared/services/coaching/lp-coaching/lp-step.service');
  }

  test('a cancelled observation is not advanced, and says so', async () => {
    const { advanceToLessonPlanStep } = load('cancelled');
    const moved = await advanceToLessonPlanStep({ sessionId: SID, from: FROM, tapperUserId: COACH.id });

    expect(moved).toBe(false);
    expect(sent.filter((s) => s.kind === 'lp_prompt')).toHaveLength(0);
    expect(store.calls.updates).toHaveLength(0);
    expect(sent.find((s) => s.kind === 'text').text).toBe(refusal);
  });

  test('an abandoned observation is not advanced either', async () => {
    const { advanceToLessonPlanStep } = load('abandoned');
    expect(await advanceToLessonPlanStep({ sessionId: SID, from: FROM, tapperUserId: COACH.id })).toBe(false);
    expect(store.calls.updates).toHaveLength(0);
  });

  test('a live observation still advances (the fence)', async () => {
    const { advanceToLessonPlanStep } = load('awaiting_photo');
    const moved = await advanceToLessonPlanStep({ sessionId: SID, from: FROM, tapperUserId: COACH.id });

    expect(moved).toBe(true);
    expect(sent.filter((s) => s.kind === 'lp_prompt')).toHaveLength(1);
    expect(store.calls.updates[0].fields.status).toBe('awaiting_lesson_plan');
    expect(sent.some((s) => s.kind === 'text' && s.text === refusal)).toBe(false);
  });
});

describe('the lesson-plan Yes/No buttons', () => {
  let sent; let store; let queued;

  function load(status) {
    jest.resetModules();
    sent = []; queued = []; store = db(row(status));
    jest.doMock('../../shared/config/supabase', () => store);
    jest.doMock('../../shared/services/whatsapp.service', () => wa(sent));
    jest.doMock('../../shared/services/coaching/coaching-job-queue.service', () => ({
      queueAnalysis: jest.fn(async (id) => { queued.push(id); return true; }),
    }));
    jest.doMock('../../shared/services/coaching/coaching-session.service', () => ({}));
    jest.doMock('../../shared/storage/r2', () => ({ uploadLessonPlanBuffer: jest.fn(), buildR2PublicUrl: jest.fn() }));
    return require('../../shared/services/coaching/lesson-plan-processor.service');
  }

  test('"No" on a cancelled observation queues no analysis and writes nothing', async () => {
    const LPP = load('cancelled');
    await LPP.handleLessonPlanResponse(SID, FROM, false);

    expect(queued).toHaveLength(0);
    expect(store.calls.updates).toHaveLength(0);
    expect(sent.find((s) => s.kind === 'text').text).toBe(refusal);
  });

  test('"No" on a live observation still queues analysis (the fence)', async () => {
    const LPP = load('awaiting_lesson_plan');
    await LPP.handleLessonPlanResponse(SID, FROM, false);

    expect(queued).toEqual([SID]);
    expect(store.calls.updates[0].fields).toMatchObject({ has_lesson_plan: false });
  });
});

describe('the analysis job arming the observer review', () => {
  let sent; let store;

  function load(status) {
    jest.resetModules();
    process.env.OBSERVE_MEWAKA_FLOW_ID = 'flow-1';
    sent = []; store = db(row(status));
    jest.doMock('../../shared/config/supabase', () => store);
    jest.doMock('../../shared/services/whatsapp.service', () => wa(sent));
    jest.doMock('../../shared/services/observe/observe-state.service', () => ({
      getState: jest.fn(async () => null), setState: jest.fn(async () => true),
    }));
    return require('../../shared/services/observe/observe-draft.service');
  }

  test('a cancelled observation is not re-armed and no form is sent', async () => {
    const Draft = load('cancelled');
    await Draft.onAnalysisReady(SID, FROM);

    expect(sent.filter((s) => s.kind === 'flow')).toHaveLength(0);
    expect(store.calls.updates.filter((u) => u.fields.status === 'awaiting_observer_review')).toHaveLength(0);
  });

  test('a live observation is still armed and the form goes out (the fence)', async () => {
    const Draft = load('analysis_complete');
    await Draft.onAnalysisReady(SID, FROM);

    expect(sent.filter((s) => s.kind === 'flow')).toHaveLength(1);
    expect(store.calls.updates.some((u) => u.fields.status === 'awaiting_observer_review')).toBe(true);
  });
});

describe('the two sweeps that re-enter the pipeline', () => {
  test('the debrief retry sweep excludes terminal observations', async () => {
    jest.resetModules();
    const store = db(row('cancelled'));
    jest.doMock('../../shared/config/supabase', () => store);
    jest.doMock('../../shared/services/cache/railway-redis.service', () => ({
      acquireLock: jest.fn(async () => true), setNX: jest.fn(async () => true), delete: jest.fn(async () => true),
    }));
    jest.doMock('../../shared/services/coaching/coaching-job-queue.service', () => ({ queueObserveDebrief: jest.fn(async () => true) }));
    const { runDebriefRetrySweep } = require('../../workers/sqs-worker');
    await runDebriefRetrySweep({ now: Date.now() });

    expect(store.calls.nots.some((n) => n.col === 'status' && String(n.val) === TERMINAL_IN_FILTER)).toBe(true);
  });

  test('the untapped-report sweep excludes terminal observations', async () => {
    jest.resetModules();
    const store = db(row('cancelled'));
    jest.doMock('../../shared/config/supabase', () => store);
    const worker = require('../../workers/stale-session.worker');
    const tally = {};
    await worker.readUntappedCandidates(tally);


    expect(store.calls.nots.some((n) => n.col === 'status' && String(n.val) === TERMINAL_IN_FILTER)).toBe(true);
  });
});

describe('the Continue tap on a stale-session reminder', () => {
  let sent; let store; let queued; let reflected;

  function load(status) {
    jest.resetModules();
    sent = []; queued = []; reflected = []; store = db(row(status));
    jest.doMock('../../shared/config/supabase', () => store);
    jest.doMock('../../shared/services/whatsapp.service', () => wa(sent));
    jest.doMock('../../shared/utils/language-cache', () => ({ getUserLanguage: jest.fn(async () => 'en') }));
    jest.doMock('../../shared/config/coaching-debrief.config', () => ({ NUM_REFLECTIVE_QUESTIONS: 3 }));
    jest.doMock('../../shared/services/coaching/coaching-job-queue.service', () => ({
      queueReport: jest.fn(async (id) => { queued.push(id); return true; }),
    }));
    jest.doMock('../../shared/services/coaching/reflective-conversation.service', () => ({
      conductReflectiveConversation: jest.fn(async (id, from, n) => { reflected.push(n); return true; }),
    }));
    return require('../../shared/services/coaching/continue-coaching.service');
  }

  test('Continue on a cancelled session reopens nothing', async () => {
    const { handleContinueCoachingTap } = load('cancelled');
    await handleContinueCoachingTap({ sessionId: SID, from: FROM, user: COACH });

    expect(reflected).toHaveLength(0);
    expect(queued).toHaveLength(0);
    expect(store.calls.updates).toHaveLength(0);
    expect(sent.find((s) => s.kind === 'text').text).toBe(refusal);
  });

  test('Continue on a live session still asks the next question (the fence)', async () => {
    const { handleContinueCoachingTap } = load('conducting_conversation');
    await handleContinueCoachingTap({ sessionId: SID, from: FROM, user: COACH });

    expect(reflected).toEqual([2]);
  });
});

describe('the debrief entry', () => {
  let sent; let store; let state;

  function load(status) {
    jest.resetModules();
    sent = []; state = []; store = db(row(status));
    jest.doMock('../../shared/config/supabase', () => store);
    jest.doMock('../../shared/services/whatsapp.service', () => wa(sent));
    jest.doMock('../../shared/services/observe/observe-state.service', () => ({
      getState: jest.fn(async () => null),
      setState: jest.fn(async (...a) => { state.push(a); return true; }),
      clearState: jest.fn(async () => true),
    }));
    jest.doMock('../../shared/services/gpt5-mini.service', () => ({ completeJson: jest.fn(async () => ({ result: {} })) }));
    return require('../../shared/services/observe/observe-debrief.service');
  }

  test('"Debrief now" on a cancelled observation arms nothing', async () => {
    const { startDebrief } = load('cancelled');
    await startDebrief(SID, FROM, COACH);

    expect(state).toHaveLength(0);
    const GPT = require('../../shared/services/gpt5-mini.service');
    expect(GPT.completeJson).not.toHaveBeenCalled();
    expect(sent.find((s) => s.kind === 'text').text).toBe(refusal);
  });
});

describe('the retry tap', () => {
  let sent; let store;

  function load(status) {
    jest.resetModules();
    sent = []; store = db(row(status));
    jest.doMock('../../shared/config/supabase', () => store);
    jest.doMock('../../shared/services/whatsapp.service', () => wa(sent));
    jest.doMock('../../shared/services/coaching/coaching-job-queue.service', () => ({
      queueTranscription: jest.fn(async () => true), queueAnalysis: jest.fn(async () => true), queueReport: jest.fn(async () => true),
    }));
    return require('../../shared/services/observe/observe-resume.service');
  }

  test('"Run it again" on a cancelled observation claims nothing', async () => {
    const Resume = load('cancelled');
    await Resume.runRetry(SID, FROM, COACH);

    expect(store.calls.updates).toHaveLength(0);
    expect(sent.find((s) => s.kind === 'text').text).toBe(refusal);
  });
});

describe('the lesson-plan list rows', () => {
  const UUID = 'd2163959-2942-4667-abb8-ab89c8cf7408';

  function deps(status, log) {
    return {
      sessionStatus: async () => status,
      sendMessage: async (to, text) => { log.sent.push({ to, text }); return true; },
      queueAnalysis: async (sid) => { log.queued.push(sid); return true; },
      resolveLanguage: async () => 'en',
      linker: { handleLPSelection: async () => { log.linked = true; return { linked: true }; } },
      setMediaTarget: async () => true,
      recomputeFidelity: async () => true,
      userId: COACH.id,
    };
  }

  test('"No lesson plan" on a cancelled observation queues no analysis', async () => {
    jest.resetModules();
    const { handleLpListSelection } = require('../../shared/services/coaching/lp-coaching/lp-list-selection.handler');
    const log = { sent: [], queued: [], linked: false };
    await handleLpListSelection(`lp_none_${UUID}`, FROM, deps('cancelled', log));

    expect(log.queued).toHaveLength(0);
    expect(log.linked).toBe(false);
    expect(log.sent[0].text).toBe(refusal);
  });

  test('"No lesson plan" on a live observation still queues analysis (the fence)', async () => {
    jest.resetModules();
    const { handleLpListSelection } = require('../../shared/services/coaching/lp-coaching/lp-list-selection.handler');
    const log = { sent: [], queued: [], linked: false };
    await handleLpListSelection(`lp_none_${UUID}`, FROM, deps('awaiting_lesson_plan', log));

    expect(log.queued).toEqual([UUID]);
  });
});

describe('the two inline photo-gate branches go through the guarded writer', () => {
  // The branch bodies live inside the webhook closure and cannot be imported
  // (the bd-2kxxa.2 / bd-5azz0 precedent), so the contract asserted here is the
  // dispatch: neither branch may write a status of its own any more.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../whatsapp-bot.js'), 'utf8');

  function branch(tap) {
    const start = src.indexOf(`else if (buttonId.startsWith('${tap}'))`);
    expect(start).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf('else if (buttonId.startsWith(', start + 10));
  }

  test.each(['photo_no_', 'photo_done_'])('%s dispatches to advanceToLessonPlanStep and writes nothing itself', (tap) => {
    const b = branch(tap);
    expect(b).toMatch(/advanceToLessonPlanStep/);
    expect(b).not.toMatch(/awaiting_lesson_plan/);
    expect(b).not.toMatch(/\.update\(/);
  });
});
