'use strict';
/**
 * bd-5rz1v.6 — the worker steps of /observe, for an observation the coach runs
 * from the PORTAL. The operator: "I dont want any of the flows to be sent over
 * to WhatsApp right now. The flow should be complete from the portal."
 *
 * So for a portal observation the same functions do the same work and write the
 * same rows — and say NOTHING to the coach on WhatsApp:
 *   analysis ready     draft stored, no MEWAKA Flow
 *   talk recorded      transcript + feedback stored, debrief done, no card / buttons;
 *                      a too-short or failed talk becomes a row marker the portal reads
 *   report             preview rendered and stored, no package / confirm buttons;
 *                      delivered to the TEACHER as always, no acks to the coach
 *   sweeps             the teacher is still nudged; the coach is not messaged
 * And a WhatsApp observation is exactly as before.
 *
 * Drives the real observe services; only the boundaries are stubbed.
 */
const COACH_PHONE = '923333232533';
const TEACHER_PHONE = '923120004471';
const SID = 'cs-obs-1';
const PORTAL_URL = `https://r2.example/bucket/classroom_audio/coach-1/2026-10/portal_abc.webm`;
const WA_URL = `https://r2.example/bucket/classroom_audio/coach-1/2026-10/683335f3_1790852380454.ogg`;
const TALK_KEY = 'classroom_audio/coach-1/2026-10/portal_talk1.webm';
const LONG = 'Coach: what went well today? Teacher: the folding worked, Ali got halves. '.repeat(20);

let mockTables;
let mockUpdates;

jest.mock('../../bot/shared/config/supabase', () => {
  const { chain } = require('../quiz/helpers/supabase-chain');
  return {
    from: jest.fn((table) => {
      const c = chain((calls) => {
        // The debrief duplicate lookup filters on the stored audio hash: no prior here.
        if (calls.some(([, col]) => /audio_hash/.test(String(col)))) return { data: null, error: null };
        return { data: (mockTables[table] || (() => null))(), error: null };
      });
      const record = (op) => (payload) => { mockUpdates.push({ table, op, payload }); return c; };
      return new Proxy(c, {
        get(target, prop) {
          if (prop === 'update' || prop === 'insert' || prop === 'upsert') return record(prop);
          return target[prop];
        },
      });
    }),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async () => null), set: jest.fn(async () => true), setexWithCeiling: jest.fn(async () => true),
  delete: jest.fn(async () => true), del: jest.fn(async () => true), setNX: jest.fn().mockResolvedValue(true), isAvailable: () => true,
}));
const mockWa = {
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
  sendReaction: jest.fn().mockResolvedValue(true),
  downloadMedia: jest.fn().mockResolvedValue(Buffer.from('whatsapp voice note')),
};
jest.mock('../../bot/shared/services/whatsapp.service', () => mockWa);
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({
  getState: jest.fn().mockResolvedValue(null), setState: jest.fn().mockResolvedValue(true), clearState: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({ completeJson: jest.fn() }));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueObserveTeacherReport: jest.fn().mockResolvedValue(true), queueObserveDebrief: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn(async () => Buffer.from('a portal talk recording')),
  uploadImageBuffer: jest.fn(async (_png, key) => key),
}));
jest.mock('../../bot/shared/services/observe/observe-coach-card', () => ({
  ...jest.requireActual('../../bot/shared/services/observe/observe-coach-card'),
  renderCoachCard: jest.fn(async () => Buffer.from('card')),
}));
jest.mock('../../bot/shared/services/coaching/transcription-processor.service', () => ({
  transcribeWithDiarization: jest.fn(),
}));
jest.mock('../../bot/shared/services/coaching/report-v2/hero-report.service', () => ({
  generateHeroReport: jest.fn(async () => ({ png: Buffer.from('report'), caption: 'cap' })),
}));
jest.mock('../../bot/shared/services/quiz/quiz-delivery.service', () => ({ _hasOpenMessageWindow: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/services/quiz/meta-window-cache.service', () => ({ markWindowClosed: jest.fn().mockResolvedValue(true) }));

process.env.OBSERVE_FRAMEWORK = 'fico';

const ObserveState = require('../../bot/shared/services/observe/observe-state.service');
const GPT = require('../../bot/shared/services/gpt5-mini.service');
const R2 = require('../../bot/shared/storage/r2');
const Transcription = require('../../bot/shared/services/coaching/transcription-processor.service');
const { renderCoachCard } = require('../../bot/shared/services/observe/observe-coach-card');
const QuizDelivery = require('../../bot/shared/services/quiz/quiz-delivery.service');
const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');

const COACH = { id: 'coach-1', name: 'Sana Malik', phone_number: COACH_PHONE, preferred_language: 'en' };
const rubric = { disparaged_teacher: false, opened_with_specific_praise: true, anchored_in_real_moment: true, asked_and_waited: true, one_improvement_only: true, moves_not_teacher: true, elicited_if_then: true, righting_reflex_held: true };
const FEEDBACK = {
  praise_line: 'You let her find her own next step.',
  wins: [{ behaviour: 'Opened with a strength', evidence: 'you folded the paper again' }, { behaviour: 'Asked, then waited', evidence: 'which lesson this week?' }],
  try: { move: 'Name one moment', evidence: 'your questions asked for answers', instead: 'quote one question she asked' },
  reflection_question: 'What did she say she will try?', value: null, rubric, concern: null,
};

function sessionRow(over = {}) {
  return {
    id: SID, user_id: 'teacher-1', observer_user_id: COACH.id, observation_type: 'leader_observation',
    audio_url: PORTAL_URL, status: 'observer_review_complete', debrief_status: 'pending',
    created_at: '2026-10-01T04:00:00Z', updated_at: '2026-10-01T05:00:00Z',
    analysis_data: { framework: 'fico' },
    users: { name: 'Ayesha Bibi', phone_number: TEACHER_PHONE, preferred_language: 'ur' },
    ...over,
  };
}
const merged = (key) => mockUpdates
  .filter((u) => u.table === 'coaching_sessions' && u.payload && u.payload.analysis_data && u.payload.analysis_data[key])
  .map((u) => u.payload.analysis_data[key]);
const toCoach = () => [
  ...mockWa.sendMessage.mock.calls, ...mockWa.sendInteractiveButtons.mock.calls,
  ...mockWa.sendImageFromBuffer.mock.calls, ...mockWa.sendFlow.mock.calls,
].filter(([to]) => to === COACH_PHONE);

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdates = [];
  mockTables = { coaching_sessions: () => sessionRow(), users: () => COACH };
  process.env.OBSERVE_REVIEW_MODE = 'off';
  process.env.OBSERVE_MEWAKA_FLOW_ID = 'flow-123';
});
afterAll(() => { delete process.env.OBSERVE_REVIEW_MODE; delete process.env.OBSERVE_MEWAKA_FLOW_ID; });

// ── analysis ready ──────────────────────────────────────────────────────────
describe('onAnalysisReady', () => {
  const Draft = () => require('../../bot/shared/services/observe/observe-draft.service');

  test('portal: the draft is stored for the portal and NOTHING goes to WhatsApp', async () => {
    mockTables.coaching_sessions = () => sessionRow({ status: 'analysis_complete', analysis_data: { framework: 'fico', domains: {} } });
    await Draft().onAnalysisReady(SID, COACH_PHONE);
    const update = mockUpdates.find((u) => u.payload && u.payload.status === 'awaiting_observer_review');
    expect(update.payload.autofill_analysis_data).toEqual({ framework: 'fico', domains: {} });
    expect(mockWa.sendFlow).not.toHaveBeenCalled();
    expect(mockWa.sendMessage).not.toHaveBeenCalled();
    expect(ObserveState.setState).not.toHaveBeenCalled();
  });

  test('WhatsApp: the MEWAKA Flow goes to the coach, as before', async () => {
    mockTables.coaching_sessions = () => sessionRow({ audio_url: WA_URL, status: 'analysis_complete' });
    await Draft().onAnalysisReady(SID, COACH_PHONE);
    expect(mockWa.sendFlow).toHaveBeenCalledWith(COACH_PHONE, expect.objectContaining({ flowId: 'flow-123' }));
    expect(ObserveState.setState).toHaveBeenCalledWith(COACH.id, 'awaiting_form', { sessionId: SID });
  });
});

// ── the talk with the teacher ───────────────────────────────────────────────
describe('processDebriefRecording', () => {
  const Debrief = () => require('../../bot/shared/services/observe/observe-debrief.service');
  const portalTalk = (od = {}) => {
    mockTables.coaching_sessions = () => sessionRow({
      analysis_data: { framework: 'fico', observer_debrief: { audio_id: null, audio_r2_key: TALK_KEY, audio_mime: 'audio/webm', guide_snapshot: { intro: 'g' }, recorded_at: '2026-10-01T06:00:00Z', ...od } },
    });
  };

  test('portal: read from R2, coached, marked done — and nothing sent to the coach', async () => {
    portalTalk();
    Transcription.transcribeWithDiarization.mockResolvedValue({ transcript: LONG, language: 'ur', diarization: null });
    GPT.completeJson.mockResolvedValue({ result: JSON.parse(JSON.stringify(FEEDBACK)) });
    await Debrief().processDebriefRecording(SID, { from: COACH_PHONE });

    expect(R2.downloadFromR2).toHaveBeenCalledWith(TALK_KEY);
    expect(mockWa.downloadMedia).not.toHaveBeenCalled();
    const od = merged('observer_debrief');
    expect(od.some((x) => x.transcript === LONG)).toBe(true);
    expect(od.some((x) => x.feedback && x.feedback.praise_line === FEEDBACK.praise_line)).toBe(true);
    expect(mockUpdates.some((u) => u.payload && u.payload.debrief_status === 'done')).toBe(true);
    expect(renderCoachCard).not.toHaveBeenCalled();
    expect(toCoach()).toEqual([]);
    expect(mockWa.sendMessage).not.toHaveBeenCalled();
  });

  test('portal: stored feedback on a redelivery is delivered silently too', async () => {
    portalTalk({ feedback: FEEDBACK });
    await Debrief().processDebriefRecording(SID, { from: COACH_PHONE });
    expect(mockUpdates.some((u) => u.payload && u.payload.debrief_status === 'done')).toBe(true);
    expect(toCoach()).toEqual([]);
  });

  test('portal: a talk too short for feedback is marked for the portal — no WhatsApp, no re-arm', async () => {
    portalTalk();
    Transcription.transcribeWithDiarization.mockResolvedValue({ transcript: 'too short', diarization: null });
    await Debrief().processDebriefRecording(SID, { from: COACH_PHONE });
    expect(merged('observer_debrief').some((x) => !!x.too_short_at)).toBe(true);
    expect(ObserveState.setState).not.toHaveBeenCalled();
    expect(toCoach()).toEqual([]);
  });

  test('portal: a feedback-model failure is marked for the portal (transcript kept) — no WhatsApp', async () => {
    portalTalk();
    Transcription.transcribeWithDiarization.mockResolvedValue({ transcript: LONG, diarization: null });
    GPT.completeJson.mockRejectedValue(new Error('model down'));
    await Debrief().processDebriefRecording(SID, { from: COACH_PHONE });
    const od = merged('observer_debrief');
    expect(od.some((x) => x.transcript === LONG)).toBe(true);
    expect(od.some((x) => !!x.feedback_failed_at)).toBe(true);
    expect(toCoach()).toEqual([]);
  });

  test('portal: a transcription failure is recorded on the row, and the coach is not messaged', async () => {
    portalTalk();
    Transcription.transcribeWithDiarization.mockRejectedValue(new Error('asr outage'));
    await Debrief().processDebriefRecording(SID, { from: COACH_PHONE });
    expect(merged('observer_debrief').some((x) => !!x.failed_at)).toBe(true);
    expect(toCoach()).toEqual([]);
  });

  test('WhatsApp: a voice-note talk too short is still told on WhatsApp and re-armed', async () => {
    mockTables.coaching_sessions = () => sessionRow({
      audio_url: WA_URL,
      analysis_data: { framework: 'fico', observer_debrief: { audio_id: 'wamid.T', guide_snapshot: { intro: 'g' }, recorded_at: '2026-10-01T06:00:00Z' } },
    });
    Transcription.transcribeWithDiarization.mockResolvedValue({ transcript: 'too short', diarization: null });
    await Debrief().processDebriefRecording(SID, { from: COACH_PHONE, audioId: 'wamid.T' });
    expect(mockWa.downloadMedia).toHaveBeenCalledWith('wamid.T');
    expect(mockWa.sendMessage).toHaveBeenCalledWith(COACH_PHONE, observeStrings('en').debrief_too_short);
    expect(ObserveState.setState).toHaveBeenCalledWith(COACH.id, 'awaiting_debrief_audio', expect.any(Object));
  });

  test('WhatsApp: a talk recorded on WhatsApp after a portal one is a WhatsApp talk (the voice note wins)', async () => {
    mockTables.coaching_sessions = () => sessionRow({
      analysis_data: { framework: 'fico', observer_debrief: { audio_id: 'wamid.T2', audio_r2_key: TALK_KEY, recorded_at: '2026-10-01T06:00:00Z' } },
    });
    Transcription.transcribeWithDiarization.mockResolvedValue({ transcript: 'too short', diarization: null });
    await Debrief().processDebriefRecording(SID, { from: COACH_PHONE });
    expect(mockWa.downloadMedia).toHaveBeenCalledWith('wamid.T2');
    expect(R2.downloadFromR2).not.toHaveBeenCalled();
    expect(mockWa.sendMessage).toHaveBeenCalledWith(COACH_PHONE, observeStrings('en').debrief_too_short);
  });
});

// ── the report ──────────────────────────────────────────────────────────────
describe('processTeacherReport', () => {
  const Send = () => require('../../bot/shared/services/observe/observe-send.service');
  const withDelivery = (td, over = {}) => {
    mockTables.coaching_sessions = () => sessionRow({ debrief_status: 'done', analysis_data: { framework: 'fico', teacher_delivery: td }, ...over });
  };

  test('preview from the portal: rendered and stored as the portal\'s — no package, no buttons to the coach', async () => {
    withDelivery({ teacher_name: 'Ayesha Bibi', teacher_phone: TEACHER_PHONE, status: 'previewing', channel: 'portal' });
    await Send().processTeacherReport(SID, { from: COACH_PHONE, phase: 'preview', channel: 'portal' });
    const td = merged('teacher_delivery').pop();
    expect(td).toMatchObject({ status: 'awaiting_confirm', report_key: `observe-reports/${SID}.png`, channel: 'portal' });
    expect(toCoach()).toEqual([]);
  });

  test('preview from WhatsApp: the coach sees the package and the confirm, and the send is WhatsApp\'s', async () => {
    withDelivery({ teacher_name: 'Ayesha Bibi', teacher_phone: TEACHER_PHONE, status: 'previewing', channel: 'portal' });
    await Send().processTeacherReport(SID, { from: COACH_PHONE, phase: 'preview' });
    expect(merged('teacher_delivery').pop()).toMatchObject({ status: 'awaiting_confirm', channel: 'whatsapp' });
    expect(mockWa.sendImageFromBuffer.mock.calls.some(([to]) => to === COACH_PHONE)).toBe(true);
    expect(mockWa.sendInteractiveButtons.mock.calls.some(([to]) => to === COACH_PHONE)).toBe(true);
  });

  const READY = { status: 'awaiting_confirm', report_key: 'observe-reports/cs.png', teacher_phone: TEACHER_PHONE, teacher_name: 'Ayesha Bibi', caption: 'cap', companion_text: 'comp' };

  test('deliver (portal, her window open): the TEACHER gets the report, the coach gets no ack', async () => {
    withDelivery({ ...READY, channel: 'portal' });
    await Send().processTeacherReport(SID, { from: COACH_PHONE, phase: 'deliver', channel: 'portal' });
    expect(mockWa.sendImageFromBuffer.mock.calls.filter(([to]) => to === TEACHER_PHONE)).toHaveLength(1);
    expect(merged('teacher_delivery').pop()).toMatchObject({ status: 'sent' });
    expect(toCoach()).toEqual([]);
  });

  test('deliver (portal, her window closed): the invite template to the teacher, no message to the coach', async () => {
    QuizDelivery._hasOpenMessageWindow.mockResolvedValueOnce(false);
    withDelivery({ ...READY, channel: 'portal' });
    await Send().processTeacherReport(SID, { from: COACH_PHONE, phase: 'deliver', channel: 'portal' });
    expect(mockWa.sendTemplate).toHaveBeenCalledWith(TEACHER_PHONE, expect.any(String), expect.any(String), expect.any(Array));
    expect(merged('teacher_delivery').pop()).toMatchObject({ status: 'awaiting_teacher_tap' });
    expect(toCoach()).toEqual([]);
  });

  test('deliver (portal) that fails is recorded as send_failed, and the coach is not messaged', async () => {
    mockWa.sendImageFromBuffer.mockResolvedValueOnce(false);
    withDelivery({ ...READY, channel: 'portal' });
    await Send().processTeacherReport(SID, { from: COACH_PHONE, phase: 'deliver', channel: 'portal' });
    expect(merged('teacher_delivery').pop()).toMatchObject({ status: 'send_failed' });
    expect(toCoach()).toEqual([]);
  });

  test('her tap on the invite (portal send): the report to her, no "she opened it" to the coach', async () => {
    withDelivery({ ...READY, status: 'awaiting_teacher_tap', template_sent_at: '2026-10-01T06:00:00Z', channel: 'portal' });
    await Send().processTeacherReport(SID, { from: TEACHER_PHONE, phase: 'teacher_tap' });
    expect(mockWa.sendImageFromBuffer.mock.calls.filter(([to]) => to === TEACHER_PHONE)).toHaveLength(1);
    expect(toCoach()).toEqual([]);
  });

  test('deliver (WhatsApp): the coach is told it landed, as before', async () => {
    withDelivery({ ...READY, channel: 'whatsapp' }, { audio_url: WA_URL });
    await Send().processTeacherReport(SID, { from: COACH_PHONE, phase: 'deliver' });
    expect(mockWa.sendMessage).toHaveBeenCalledWith(COACH_PHONE, observeStrings('en').send_done_fo);
  });
});

// ── sweeps ──────────────────────────────────────────────────────────────────
describe('the chase-up sweeps', () => {
  const Send = () => require('../../bot/shared/services/observe/observe-send.service');
  const NOW = Date.parse('2026-10-03T12:00:00Z');

  test('untapped (portal send): the teacher is nudged, the coach is not messaged', async () => {
    mockTables.coaching_sessions = () => sessionRow({ debrief_status: 'done', analysis_data: { teacher_delivery: {
      status: 'awaiting_teacher_tap', template_sent_at: '2026-10-02T06:00:00Z', teacher_phone: TEACHER_PHONE, teacher_name: 'Ayesha Bibi', channel: 'portal',
    } } });
    const out = await Send().processUntappedDelivery(SID, NOW);
    expect(out.action).toBe('nudge');
    expect(mockWa.sendTemplate).toHaveBeenCalledWith(TEACHER_PHONE, expect.any(String), expect.any(String), expect.any(Array));
    expect(toCoach()).toEqual([]);
  });

  test('untapped (WhatsApp send): the coach still hears about the nudge', async () => {
    mockTables.coaching_sessions = () => sessionRow({ audio_url: WA_URL, debrief_status: 'done', analysis_data: { teacher_delivery: {
      status: 'awaiting_teacher_tap', template_sent_at: '2026-10-02T06:00:00Z', teacher_phone: TEACHER_PHONE, teacher_name: 'Ayesha Bibi',
    } } });
    await Send().processUntappedDelivery(SID, NOW);
    expect(mockWa.sendMessage.mock.calls.some(([to]) => to === COACH_PHONE)).toBe(true);
  });

  test('undelivered (portal observation, no report started): the cadence advances, the coach is not messaged', async () => {
    mockTables.coaching_sessions = () => sessionRow({ updated_at: '2026-10-02T06:00:00Z', analysis_data: {} });
    const out = await Send().processUndeliveredDelivery(SID, NOW);
    expect(out.action).toBe('remind');
    expect(merged('teacher_delivery').pop()).toMatchObject({ reminder_count: 1 });
    expect(toCoach()).toEqual([]);
  });

  test('undelivered (WhatsApp observation): the coach is reminded, as before', async () => {
    mockTables.coaching_sessions = () => sessionRow({ audio_url: WA_URL, updated_at: '2026-10-02T06:00:00Z', analysis_data: {} });
    await Send().processUndeliveredDelivery(SID, NOW);
    expect(mockWa.sendMessage.mock.calls.some(([to]) => to === COACH_PHONE)).toBe(true);
  });
});

// ── the draft, through the REAL review-form functions (no stub of the module under audit) ──
describe('getDraft / saveDraft against the real buildScreenPrefill + applyObserverEdits', () => {
  const Svc = () => require('../../bot/shared/services/observe/portal-observe.service');
  const ind = (id, score) => ({ id, name: id, score, applicable: true, evidence_summary: `seen ${id}`, improvement_sw: `try ${id}` });
  const ANALYSIS = {
    framework: 'fico',
    domains: {
      lesson_plan_fidelity: { indicators: [ind('B1', 1)] },
      high_leverage_practices: { indicators: [ind('C1', 0), ind('C2', 2)] },
      student_engagement: { indicators: [ind('D1', 1)] },
      teacher_subject_knowledge: { indicators: [ind('F1', 2)] },
    },
    lp_fidelity: {
      status: 'ok', fidelity_pct: 50, band: 'average', prescribed_count: 2,
      moves: [
        { move_id: 'm1', text: 'Fold a paper into halves', phase: 'opening', verdict: 'executed', evidence: 'She folded it', rationale: 'seen', counted: true, bucket: 'core' },
        { move_id: 'm2', text: 'Pairs fold their own paper', phase: 'practice', verdict: 'not_done', evidence: '', rationale: 'no paper', counted: true, bucket: 'core' },
      ],
    },
  };
  const OLD_FID = process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY;
  beforeEach(() => {
    process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY = 'editable';
    // Arrays, so a write's `.select('id')` answers with the row it matched.
    mockTables.coaching_sessions = () => [sessionRow({
      status: 'awaiting_observer_review',
      analysis_data: JSON.parse(JSON.stringify(ANALYSIS)),
      autofill_analysis_data: JSON.parse(JSON.stringify(ANALYSIS)),
    })];
  });
  afterAll(() => { if (OLD_FID === undefined) delete process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY; else process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY = OLD_FID; });

  test('the sections are the Flow\'s screens, pre-filled as the Flow pre-fills them', async () => {
    const out = await Svc().getDraft({ userId: COACH.id, coachingSessionId: SID });
    expect(out.status).toBe('ok');
    expect(out.sections.map((s) => s.letter)).toEqual(['B', 'C', 'D', 'F']);
    const b = out.sections[0];
    expect(b.kind).toBe('moves');
    expect(b.moves.map((m) => [m.k, m.verdict])).toEqual([[1, 'executed'], [2, 'not_done']]);
    const c = out.sections[1];
    expect(c.kind).toBe('indicators');
    const c1 = c.indicators.find((i) => i.id === 'C1');
    expect(c1).toMatchObject({ field: 'C1', rating: '0', evidence: 'seen C1', improvement: 'try C1' });
    expect(out.scale.map((o) => o.id)).toEqual(expect.arrayContaining(['0', '1', '2']));
  });

  test('saving the Flow\'s keys writes v2 and observer_review_complete, exactly as the Flow\'s submit', async () => {
    const draft = await Svc().getDraft({ userId: COACH.id, coachingSessionId: SID });
    const edits = {};
    for (const s of draft.sections) {
      if (s.kind === 'moves') for (const m of s.moves) { edits[`fid_r_${m.k}`] = m.verdict; edits[`fid_e_${m.k}`] = m.evidence; }
      else for (const i of s.indicators) { edits[`r_${i.field}`] = i.rating; edits[`ev_${i.field}`] = i.evidence; edits[`imp_${i.field}`] = i.improvement; }
    }
    edits.r_C1 = '2';
    edits.fid_r_2 = 'executed';
    const out = await Svc().saveDraft({ userId: COACH.id, coachingSessionId: SID, edits });
    expect(out.status).toBe('ok');
    const write = mockUpdates.find((u) => u.payload && u.payload.status === 'observer_review_complete');
    expect(write).toBeDefined();
    const v2 = write.payload.analysis_data;
    expect(v2.domains.high_leverage_practices.indicators.find((i) => i.id === 'C1').score).toBe(2);
    expect(v2.lp_fidelity.moves[1].verdict).toBe('executed');
    expect(v2.observer_edit_summary).toMatchObject({ indicators_rescored: 1, fidelity_verdicts_changed: 1 });
    expect(toCoach()).toEqual([]);
  });
});
