'use strict';
/**
 * Meta bill cut NC5 — sweeper/recovery repeats. EXECUTED through the real
 * stale-session sweeps and analysis job; only the network edges are faked.
 *
 *   N1-12  a teacher with N stale sessions got N "incomplete coaching session"
 *          reminders in the same minute (51 bursts of 10 in a week) → one
 *          reminder per teacher, for their newest stale session.
 *   N2-U02 the 12-hour auto-complete sent its own English notice before the report
 *          → no notice; the report's caption carries the line (report-generator,
 *          pinned in meta-bill-nc2-report-caption.test.js).
 *   N2-C18 the confirm-gate recovery sent an English "I've gone ahead…" and, seconds
 *          later, Step 1/5 → ONE notice, in their language, carrying the 15-minute wait;
 *          the transcription job is told Step 1/5 is already said.
 *   N2-C05 the photo-gate recovery sent "I'm putting together your report…", then
 *          Step 2/5, then Step 4/5 → the notice only (the analysis + report jobs are
 *          told it went out). The notice now reads their stored language too.
 *   N1-13  the reflective question is asked once per (session, question) even when
 *          the analysis job runs twice; "Continue Now" may still re-ask it.
 */
const { createFakeSupabase } = require('../fixtures/fake-supabase');

const HOUR = 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

describe('stale-session sweeps', () => {
  const sends = [];
  const queued = [];
  let Stale;
  let db;

  function load(seedDb) {
    jest.resetModules();
    sends.length = 0;
    queued.length = 0;
    db = seedDb;
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: (t) => db.from(t) }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendInteractiveButtons: jest.fn(async (to, options) => { sends.push({ kind: 'buttons', to, options }); return true; }),
      sendMessage: jest.fn(async (to, text) => { sends.push({ kind: 'text', to, text }); return true; }),
    }));
    jest.doMock('../../bot/shared/services/queue', () => ({
      queueCoachingJob: jest.fn(async (sessionId, jobType, payload) => { queued.push({ sessionId, jobType, payload }); return 'm'; }),
    }));
    Stale = require('../../bot/workers/stale-session.worker');
    return Stale;
  }

  const TEACHER_A = { name: 'Ayesha Khan', phone_number: '000000000001', preferred_language: 'ur' };
  const TEACHER_B = { name: 'Bilal', phone_number: '000000000002', preferred_language: 'en' };
  function reflection(id, userId, users, idleMs, createdAgoMs, extra = {}) {
    return {
      id, user_id: userId, status: 'conducting_conversation',
      conversation_state: { last_interaction: ago(idleMs), questions_answered: 0 },
      transcript_text: null, analysis_data: {}, lesson_plan_text: null, reminder_sent_at: null,
      created_at: ago(createdAgoMs), users, ...extra,
    };
  }

  describe('N1-12 — one reminder per teacher per sweep', () => {
    test('three stale sessions, one teacher → ONE reminder, for the newest', async () => {
      load(createFakeSupabase({ coaching_sessions: [
        reflection('s-old', 'u-a', TEACHER_A, 3 * HOUR, 9 * HOUR),
        reflection('s-mid', 'u-a', TEACHER_A, 3 * HOUR, 6 * HOUR),
        reflection('s-new', 'u-a', TEACHER_A, 3 * HOUR, 4 * HOUR),
      ] }));
      await Stale.processStaleCoachingSessions();
      const reminders = sends.filter((s) => s.kind === 'buttons');
      expect(reminders).toHaveLength(1);
      expect(reminders[0].options.buttons[0].id).toBe('coaching_continue_s-new');
    });

    test('the next sweep does not walk down to the older sessions', async () => {
      load(createFakeSupabase({ coaching_sessions: [
        reflection('s-old', 'u-a', TEACHER_A, 3 * HOUR, 9 * HOUR),
        reflection('s-new', 'u-a', TEACHER_A, 3 * HOUR, 4 * HOUR),
      ] }));
      await Stale.processStaleCoachingSessions();
      await Stale.processStaleCoachingSessions();
      expect(sends.filter((s) => s.kind === 'buttons')).toHaveLength(1);
    });

    test('two teachers → one reminder EACH', async () => {
      load(createFakeSupabase({ coaching_sessions: [
        reflection('s-a1', 'u-a', TEACHER_A, 3 * HOUR, 5 * HOUR),
        reflection('s-a2', 'u-a', TEACHER_A, 3 * HOUR, 4 * HOUR),
        reflection('s-b1', 'u-b', TEACHER_B, 3 * HOUR, 4 * HOUR),
      ] }));
      await Stale.processStaleCoachingSessions();
      expect(sends.filter((s) => s.kind === 'buttons').map((s) => s.to).sort()).toEqual(['000000000001', '000000000002']);
    });

    test('a NEWER lesson than the one already reminded still gets its reminder', async () => {
      load(createFakeSupabase({ coaching_sessions: [
        reflection('s-reminded', 'u-a', TEACHER_A, 5 * HOUR, 10 * HOUR, { reminder_sent_at: ago(2 * HOUR) }),
        reflection('s-later', 'u-a', TEACHER_A, 3 * HOUR, 4 * HOUR),
      ] }));
      await Stale.processStaleCoachingSessions();
      const reminders = sends.filter((s) => s.kind === 'buttons');
      expect(reminders).toHaveLength(1);
      expect(reminders[0].options.buttons[0].id).toBe('coaching_continue_s-later');
    });
  });

  describe('N2-U02 — the 12-hour auto-complete sends no notice of its own', () => {
    test('report queued (autoCompleted), NO text — the report caption carries the line', async () => {
      load(createFakeSupabase({ coaching_sessions: [reflection('s-auto', 'u-a', TEACHER_A, 13 * HOUR, 14 * HOUR)] }));
      await Stale.processStaleCoachingSessions();
      expect(sends).toEqual([]);
      const reports = queued.filter((q) => q.jobType === 'report_generation');
      expect(reports).toHaveLength(1);
      expect(reports[0].payload).toMatchObject({ autoCompleted: true });
    });
  });

  describe('N2-C18 — confirm-gate recovery: ONE notice, in their language, carrying the wait', () => {
    const initiated = (users) => ({ id: 's-gate', user_id: 'u-a', status: 'initiated', audio_id: 'audio-1', created_at: ago(2 * HOUR), users });

    test.each([
      ['ur', TEACHER_A, 'coachingConfirmGateProceeding', { name: 'Ayesha' }],
      ['en', { ...TEACHER_B }, 'coachingConfirmGateProceeding', { name: 'Bilal' }],
      ['ur', { phone_number: '000000000003', name: null, preferred_language: 'ur' }, 'coachingConfirmGateProceedingNoName', {}],
    ])('[%s] notice = %s; the transcription job is told Step 1/5 is said', async (lang, users, key, params) => {
      load(createFakeSupabase({ coaching_sessions: [initiated(users)] }));
      const { resolveUx } = require('../../bot/shared/config/ux-strings');
      const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');
      await Stale.processStuckInitiatedSessions();

      const texts = sends.filter((s) => s.kind === 'text').map((s) => s.text);
      expect(texts).toEqual([resolveUx(key, { language: lang, params })]);
      // the wait sentence Step 1/5 carried rides on the notice
      const wait = getCoachingMessage('step1_transcribing', lang).split(lang === 'ur' ? '۔ ' : '. ').slice(1).join(lang === 'ur' ? '۔ ' : '. ');
      expect(texts[0]).toContain(wait.trim());
      const jobs = queued.filter((q) => q.jobType === 'transcription');
      expect(jobs).toHaveLength(1);
      expect(jobs[0].payload).toMatchObject({ audioId: 'audio-1', step1Announced: true });
    });

    test('FALLBACK — the notice did not go out → the job sends Step 1/5 as before', async () => {
      load(createFakeSupabase({ coaching_sessions: [initiated(TEACHER_A)] }));
      require('../../bot/shared/services/whatsapp.service').sendMessage.mockResolvedValueOnce(false);
      await Stale.processStuckInitiatedSessions();
      const jobs = queued.filter((q) => q.jobType === 'transcription');
      expect(jobs).toHaveLength(1);
      expect(jobs[0].payload.step1Announced).toBeUndefined();
    });
  });

  describe('N2-C05 — photo-gate recovery: the notice, then no Step 2/5 or 4/5', () => {
    function photoGateDb(row) {
      const state = { row: { ...row }, selects: [] };
      return {
        state,
        from: () => {
          const b = { _update: null, _cols: '' };
          b.select = (c) => { if (c) { b._cols = c; state.selects.push(c); } return b; };
          ['eq', 'in', 'lt', 'order', 'limit', 'not', 'is'].forEach((m) => { b[m] = () => b; });
          b.update = (p) => { b._update = p; return b; };
          const settle = () => {
            if (b._update) { state.row = { ...state.row, ...b._update }; return { data: [state.row], error: null }; }
            return { data: [state.row], error: null };
          };
          b.single = async () => ({ data: state.row, error: null });
          b.maybeSingle = async () => ({ data: state.row, error: null });
          b.then = (ok, ko) => Promise.resolve(settle()).then(ok, ko);
          return b;
        },
      };
    }
    const gateRow = (users) => ({
      id: 's-photo', user_id: 'u-a', observer_user_id: null, observation_type: null, status: 'awaiting_photo',
      created_at: ago(3 * HOUR), updated_at: ago(3 * HOUR), transcript_text: 'class audio',
      conversation_state: { current_state: 'AWAITING_PHOTO' }, users,
    });

    test('Urdu teacher → the Urdu notice, then the analysis is queued with progressNoticeSent', async () => {
      const fake = photoGateDb(gateRow(TEACHER_A));
      load(fake);
      const { resolveUx } = require('../../bot/shared/config/ux-strings');
      await Stale.processStuckPhotoGateSessions();
      // The sweep must ASK for their language: PostgREST embeds only what the select names.
      expect(fake.state.selects.some((c) => /users!inner\([^)]*preferred_language/.test(c))).toBe(true);
      const texts = sends.filter((s) => s.kind === 'text').map((s) => s.text);
      expect(texts).toEqual([resolveUx('coachingPhotoGateAdvancing', { language: 'ur', params: { name: 'Ayesha' } })]);
      const jobs = queued.filter((q) => q.jobType === 'analysis');
      expect(jobs).toHaveLength(1);
      expect(jobs[0].payload).toMatchObject({ skipReflection: true, progressNoticeSent: true });
    });

    test('FALLBACK — the notice did not go out → no flag, the steps are said as before', async () => {
      load(photoGateDb(gateRow(TEACHER_A)));
      require('../../bot/shared/services/whatsapp.service').sendMessage.mockResolvedValueOnce(false);
      await Stale.processStuckPhotoGateSessions();
      const jobs = queued.filter((q) => q.jobType === 'analysis');
      expect(jobs).toHaveLength(1);
      expect(jobs[0].payload.progressNoticeSent).toBeUndefined();
    });
  });
});

describe('N2-C05 — the analysis job: no Step 2/5, and the report job is told', () => {
  function load() {
    jest.resetModules();
    const sent = [];
    const reports = [];
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../bot/shared/utils/constants', () => ({ PEDAGOGICAL_ANALYSIS_MEDIA_ID: null }));
    jest.doMock('../../bot/shared/config/supabase', () => {
      const b = {};
      ['select', 'update', 'eq', 'not'].forEach((m) => { b[m] = () => b; });
      b.single = async () => ({ data: { id: 's-1', user_id: 'u-1', observation_type: null, transcript_text: 't', transcript_language: 'en', users: { phone_number: '923001234567', name: 'A' } }, error: null });
      b.maybeSingle = async () => ({ data: { users: { preferred_language: 'en' } }, error: null });
      b.then = (ok) => Promise.resolve({ data: null, error: null }).then(ok);
      return { from: () => b };
    });
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn(async (to, text) => { sent.push(text); return true; }), sendSticker: jest.fn(async () => true),
    }));
    jest.doMock('../../bot/shared/services/gpt5-mini.service', () => ({
      analyzePedagogy: jest.fn(async () => ({ analysis: { executive_summary: 'ok' }, usage: { input_tokens: 1, output_tokens: 1, cached_tokens: 0, cost: 0 } })),
      extractReflectiveCorpus: jest.fn(async () => null),
    }));
    jest.doMock('../../bot/shared/services/coaching/coaching-session.service', () => ({ updateStatus: jest.fn(async () => ({})), markAsFailed: jest.fn(async () => ({})) }));
    jest.doMock('../../bot/shared/services/coaching/report-generator.service', () => ({ fetchAndCompressPriorFeedback: jest.fn(async () => ({ exists: false })) }));
    jest.doMock('../../bot/shared/services/coaching/frameworks/framework-selector', () => ({
      selectFrameworkWithReason: jest.fn(async () => ({ framework: { name: 'fico' }, frameworkKey: 'fico', reason: 'default' })),
    }));
    jest.doMock('../../bot/shared/services/coaching/reflective-conversation.service', () => ({ conductReflectiveConversation: jest.fn(async () => {}) }));
    jest.doMock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
      queueReport: jest.fn(async (sid, meta) => { reports.push(meta); }),
    }));
    const AP = require('../../bot/shared/services/coaching/analysis-processor.service');
    const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');
    return { AP, sent, reports, getCoachingMessage };
  }

  test('skipReflection + progressNoticeSent → no Step 2/5; queueReport carries progressNoticeSent', async () => {
    const a = load();
    await a.AP.processAnalysis('s-1', { from: '923001234567', skipReflection: true, progressNoticeSent: true });
    expect(a.sent).not.toContain(a.getCoachingMessage('step2_analyzing', 'en'));
    expect(a.reports).toEqual([expect.objectContaining({ partial: true, suppressPartialBanner: true, progressNoticeSent: true })]);
  });

  test('CONTROL — recovery without a delivered notice still says Step 2/5', async () => {
    const a = load();
    await a.AP.processAnalysis('s-1', { from: '923001234567', skipReflection: true });
    expect(a.sent).toContain(a.getCoachingMessage('step2_analyzing', 'en'));
    expect(a.reports[0].progressNoticeSent).toBeUndefined();
  });
});

describe('N1-13 — the reflective question is asked once per session', () => {
  const sent = [];
  const mockRedis = new Map();
  function load() {
    jest.resetModules();
    // The analysis-job block above doMock'ed these; a doMock outlives resetModules.
    jest.dontMock('../../bot/shared/services/coaching/reflective-conversation.service');
    jest.dontMock('../../bot/shared/utils/constants');
    sent.length = 0;
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
      setNX: jest.fn(async (k, v) => { if (mockRedis.has(k)) return false; mockRedis.set(k, v); return true; }),
      delete: jest.fn(async (k) => { mockRedis.delete(k); return true; }),
    }));
    jest.doMock('../../bot/shared/config/supabase', () => {
      const b = {};
      ['select', 'update', 'eq'].forEach((m) => { b[m] = () => b; });
      b.single = async () => ({ data: { analysis_data: {}, conversation_state: { questions: [] }, transcript_text: 't', user_id: 'u-1' }, error: null });
      return { from: () => b };
    });
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendAudio: jest.fn(async () => { sent.push('audio'); return true; }),
      sendMessage: jest.fn(async (to, text) => { sent.push(`text:${text}`); return true; }),
    }));
    jest.doMock('../../bot/shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OGG'), durationSec: 5 })) }));
    jest.doMock('../../bot/shared/utils/language-cache', () => ({ getUserLanguage: jest.fn(async () => 'en') }));
    jest.doMock('../../bot/shared/services/coaching/coaching-session.service', () => ({
      updateConversationState: jest.fn(async () => ({})), updateStatus: jest.fn(async () => ({})),
    }));
    return require('../../bot/shared/services/coaching/reflective-conversation.service');
  }
  beforeEach(() => mockRedis.clear());

  test('the analysis job running twice → the question goes out ONCE', async () => {
    const R = load();
    await R.conductReflectiveConversation('s-q', '923001234567');
    await R.conductReflectiveConversation('s-q', '923001234567');
    expect(sent).toEqual(['audio']);
  });

  test('"Continue Now" re-asks the unanswered question on purpose — it is not a duplicate', async () => {
    const R = load();
    await R.conductReflectiveConversation('s-q', '923001234567');
    await R.conductReflectiveConversation('s-q', '923001234567', 1, { reask: true });
    expect(sent).toEqual(['audio', 'audio']);
  });

  test('a question that reached them by NEITHER voice nor text gives its claim back', async () => {
    const R = load();
    const WA = require('../../bot/shared/services/whatsapp.service');
    WA.sendAudio.mockResolvedValueOnce(false);
    WA.sendMessage.mockResolvedValueOnce(false);
    await R.conductReflectiveConversation('s-q', '923001234567');
    await R.conductReflectiveConversation('s-q', '923001234567');
    expect(WA.sendAudio).toHaveBeenCalledTimes(2);
  });
});
