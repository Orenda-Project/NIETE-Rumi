'use strict';
/**
 * bd-5rz1v.6 — a coach's /observe observation, run from the PORTAL (bot side:
 * bot/shared/services/observe/portal-observe.service.js).
 *
 * The operator: "The flow should be complete from the portal. The coach should
 * get the draft report, edit it the same way they can edit stuff on whatsapp
 * bot, and then send that report to the teacher." So every coach step of
 * /observe is reachable here, each through the SAME function WhatsApp uses:
 *
 *   start        the row startFromAudio writes (bound teacher, observer split)
 *   draft        buildScreenPrefill / applyObserverEdits — the MEWAKA Flow's pair
 *   talk         the guide startDebrief builds; the recording processDebriefRecording reads
 *   report       processTeacherReport's preview and deliver phases
 *
 * Only the observing coach, and only an observation she started in the portal.
 */

const SVC = '../../bot/shared/services/observe/portal-observe.service';

const COACH = 'c0ac0000-0000-4000-8000-000000000001';
const OTHER = 'c0ac0000-0000-4000-8000-000000000002';
const TEACHER_UID = '7eac0000-0000-4000-8000-000000000003';
const KEY = `classroom_audio/${COACH}/2026-10/portal_abc123.webm`;
const URL = (k) => `https://r2.example/bucket/${k}`;
const SID = 'cs-obs-1';

function fakeSupabase(answer = {}) {
  const writes = { inserts: [], updates: [] };
  const from = (table) => {
    const q = { table, filters: {}, ops: [] };
    const self = new Proxy(q, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'insert') return (row) => { writes.inserts.push({ table, row }); target.inserted = row; return self; };
        if (prop === 'update') return (patch) => { target.patch = patch; return self; };
        if (prop === 'eq') return (c, v) => { target.filters[c] = v; return self; };
        if (prop === 'single' || prop === 'maybeSingle') {
          return async () => {
            if (target.patch) writes.updates.push({ table, patch: target.patch, filters: target.filters });
            if (target.inserted) return { data: { id: SID, ...target.inserted }, error: null };
            const fn = answer[table];
            const data = typeof fn === 'function' ? fn(target.filters, 'one') : (fn ?? null);
            return { data: Array.isArray(data) ? (data[0] || null) : data, error: null };
          };
        }
        if (prop === 'then') {
          return (res, rej) => {
            if (target.patch) writes.updates.push({ table, patch: target.patch, filters: target.filters });
            const fn = answer[table];
            const data = typeof fn === 'function' ? fn(target.filters, 'many') : (fn ?? null);
            return Promise.resolve({ data, error: null }).then(res, rej);
          };
        }
        return (...args) => { target.ops.push([prop, ...args]); return self; };
      },
    });
    return self;
  };
  return { from, writes };
}

const coachRow = (over = {}) => ({ id: COACH, phone_number: '923333232533', role: 'coach', name: 'Sana Malik', preferred_language: 'en', ...over });
const ayesha = { teacher_ext_id: '923120004471', teacher_name: 'Ayesha Bibi', phone_e164: '923120004471', user_id: TEACHER_UID, preferred_language: 'ur' };

function obsRow(over = {}) {
  return {
    id: SID,
    user_id: TEACHER_UID,
    observer_user_id: COACH,
    observation_type: 'leader_observation',
    audio_url: URL(KEY),
    status: 'observer_review_complete',
    debrief_status: 'pending',
    created_at: '2026-10-02T04:30:00Z',
    analysis_data: { framework: 'fico' },
    users: { name: 'Ayesha Bibi', phone_number: '923120004471' },
    ...over,
  };
}

function deps(over = {}) {
  const supabase = over.supabase || fakeSupabase({
    users: () => coachRow(),
    coaching_sessions: () => null,
  });
  return {
    supabase,
    r2: {
      headObject: jest.fn().mockResolvedValue({ exists: true, sizeBytes: 9_000_000 }),
      buildR2PublicUrl: URL,
      getPresignedUrl: jest.fn(async (u) => `${u}?sig=1`),
      ...(over.r2 || {}),
    },
    queue: {
      queueTranscription: jest.fn().mockResolvedValue('m1'),
      queueObserveDebrief: jest.fn().mockResolvedValue('m2'),
      queueObserveTeacherReport: jest.fn().mockResolvedValue('m3'),
      ...(over.queue || {}),
    },
    leaderSource: { resolveTeacher: jest.fn().mockResolvedValue(ayesha), ...(over.leaderSource || {}) },
    resolveOwner: over.resolveOwner || jest.fn().mockResolvedValue(TEACHER_UID),
    schedule: { markDone: jest.fn().mockResolvedValue(true), ...(over.schedule || {}) },
    library: {
      resolveAsset: jest.fn().mockResolvedValue({ assetId: 'asset-9' }),
      readyRender: jest.fn().mockResolvedValue({ r2Key: 'lp612/seg.pdf' }),
      link: jest.fn().mockResolvedValue(true),
      recent: jest.fn().mockResolvedValue([{ asset_id: 'a1', lesson_id: 'g4-math-ch5-d2', topic: 'Fractions', grade: 4, subject: 'Maths' }]),
      ...(over.library || {}),
    },
    draft: over.draft || {
      buildScreenPrefill: jest.fn((analysis, key) => (key === 'lesson_plan_fidelity'
        ? { scale: [{ id: '0', title: '0 · Not observed' }], has_fidelity: true, no_fidelity: false, fid_header: 'Measured 75%', fid_fallback: '', mv_1: 'Fold paper', mv_1_v: true, fr_1: 'executed', fe_1: 'She folded it', mv_2: '', mv_2_v: false, fr_2: 'not_adjudicable', fe_2: '' }
        : { scale: [{ id: '0', title: '0 · Not observed' }], s_C1: '1', e_C1: 'Asked facts', i_C1: 'Ask why' })),
      applyObserverEdits: jest.fn().mockResolvedValue({ indicators_rescored: 1, text_fields_changed: 0 }),
      FIDELITY_VERDICT_OPTIONS: [{ id: 'executed', title: '✓ Executed' }],
      MAX_MOVE_SLOTS: 2,
    },
    pack: over.pack || (() => ({
      domainOrder: ['lesson_plan_fidelity', 'high_leverage_practices'],
      domains: {
        lesson_plan_fidelity: { key: 'B', title: 'Lesson Plan Fidelity', indicators: [{ id: 'B1', name: 'Clarity' }] },
        high_leverage_practices: { key: 'C', title: 'High-Leverage Practices', indicators: [{ id: 'C1', name: 'Quality Questioning' }] },
      },
      scaleOptions: [{ id: '0', title: '0 · Not observed' }, { id: 'na', title: '— N/A' }],
    })),
    languageFor: over.languageFor || jest.fn().mockResolvedValue('en'),
    debrief: {
      buildDebriefGuide: jest.fn().mockResolvedValue({ intro: 'Hi', sections: { strengths: { title: 'S', say_this: 's' }, growth: { title: 'G', say_this: 'g' }, action: { title: 'A', say_this: 'a' } }, reflection_question: 'q', outro: 'o' }),
      mergeObserverDebrief: jest.fn().mockResolvedValue({}),
      freshRecordingPatch: jest.fn(({ audioId, audioMime, guideSnapshot, recordedAt }) => ({ audio_id: audioId, audio_mime: audioMime, guide_snapshot: guideSnapshot, recorded_at: recordedAt, transcript: null, feedback: null, attempts: 0 })),
      ...(over.debrief || {}),
    },
    send: { mergeTeacherDelivery: jest.fn().mockResolvedValue({}), ...(over.send || {}) },
    roster: { upsertTeacher: jest.fn().mockResolvedValue(true), ...(over.roster || {}) },
    people: { teacherOf: jest.fn().mockResolvedValue({ name: 'Ayesha Bibi', phone: '923120004471' }), ...(over.people || {}) },
    log: jest.fn(),
    now: () => new Date('2026-10-02T05:00:00Z'),
    newId: () => 'nonce-1',
  };
}

let Svc;
beforeEach(() => { jest.resetModules(); Svc = require(SVC); });

describe('startPortalObservation — the row startFromAudio writes, from the portal', () => {
  const start = (args, d) => Svc.startPortalObservation({ userId: COACH, teacherExtId: ayesha.teacher_ext_id, schoolExtId: 'sch-1', key: KEY, ...args }, d);

  test('the bound teacher owns the row; the coach is the observer; transcription is queued with her phone', async () => {
    const d = deps();
    const out = await start({}, d);
    expect(out).toEqual({ status: 'ok', coachingSessionId: SID });

    expect(d.leaderSource.resolveTeacher).toHaveBeenCalledWith(COACH, ayesha.teacher_ext_id, 'sch-1');
    expect(d.resolveOwner).toHaveBeenCalledWith({ ...ayesha, school_ext_id: 'sch-1' });

    const insert = d.supabase.writes.inserts.find((w) => w.table === 'coaching_sessions');
    expect(insert.row).toMatchObject({
      user_id: TEACHER_UID,
      session_id: null,
      audio_id: null,
      audio_url: URL(KEY),
      audio_duration_seconds: null,
      status: 'confirmed',
      observation_type: 'leader_observation',
      observer_user_id: COACH,
      debrief_status: 'pending',
      has_lesson_plan: false,
      lesson_plan_link_method: 'none',
    });
    expect(d.queue.queueTranscription).toHaveBeenCalledWith(SID, { from: '923333232533' });
    expect(d.schedule.markDone).toHaveBeenCalledWith(COACH, ayesha.teacher_ext_id, 'sch-1', SID);
  });

  test('her lesson plan picked from the library is resolved for the TEACHER and linked before transcription', async () => {
    const d = deps();
    const order = [];
    d.library.link.mockImplementation(async () => { order.push('link'); });
    d.queue.queueTranscription.mockImplementation(async () => { order.push('queue'); });
    await start({ lessonPlan: { lessonId: 'g4-math-ch5-d2' } }, d);
    expect(d.library.resolveAsset).toHaveBeenCalledWith({ userId: TEACHER_UID, lessonId: 'g4-math-ch5-d2' });
    expect(d.library.link).toHaveBeenCalledWith(SID, 'asset-9');
    expect(order).toEqual(['link', 'queue']);
  });

  test('a photo of her plan and board photos are written as the WhatsApp gates write them', async () => {
    const d = deps();
    const planKey = `lesson_plans/${COACH}/portal_p1.jpg`;
    const photo = `images/${COACH}/portal_ph1.jpg`;
    await start({ lessonPlanKey: planKey, photoKeys: [photo] }, d);
    const { row } = d.supabase.writes.inserts.find((w) => w.table === 'coaching_sessions');
    expect(row).toMatchObject({
      has_lesson_plan: true, lesson_plan_r2_key: planKey, lesson_plan_url: URL(planKey), lesson_plan_format: 'jpg',
      lesson_plan_extraction_status: 'pending',
      classroom_photos: [{ url: URL(photo), uploaded_at: '2026-10-02T05:00:00.000Z' }],
    });
    expect(row.conversation_state).toEqual({ classroom_photos: row.classroom_photos });
  });

  test('refuses a key that is not the coach\'s own upload', async () => {
    const d = deps();
    const out = await start({ key: `classroom_audio/${OTHER}/2026-10/portal_x.webm` }, d);
    expect(out).toEqual({ status: 'invalid', reason: 'not_your_upload' });
    expect(d.supabase.writes.inserts).toEqual([]);
  });

  test('refuses a caller who is not a school leader', async () => {
    const d = deps({ supabase: fakeSupabase({ users: () => coachRow({ role: 'teacher' }), coaching_sessions: () => null }) });
    expect(await start({}, d)).toEqual({ status: 'invalid', reason: 'not_a_leader' });
    expect(d.queue.queueTranscription).not.toHaveBeenCalled();
  });

  test('refuses a teacher who is not in her patch', async () => {
    const d = deps({ leaderSource: { resolveTeacher: jest.fn().mockResolvedValue(null) } });
    expect(await start({}, d)).toEqual({ status: 'invalid', reason: 'not_your_teacher' });
    expect(d.supabase.writes.inserts).toEqual([]);
  });

  test('refuses without a teacher at all — a portal observation is never unbound', async () => {
    const d = deps();
    expect(await start({ teacherExtId: '' }, d)).toEqual({ status: 'invalid', reason: 'no_teacher' });
  });

  test('refuses a missing upload, too many photos, and two plans', async () => {
    const missing = deps({ r2: { headObject: jest.fn().mockResolvedValue({ exists: false }) } });
    expect(await start({}, missing)).toMatchObject({ status: 'invalid', reason: 'upload_missing' });
    const photos = [1, 2, 3, 4].map((i) => `images/${COACH}/portal_p${i}.jpg`);
    expect(await start({ photoKeys: photos }, deps())).toEqual({ status: 'invalid', reason: 'too_many_photos' });
    expect(await start({ lessonPlanKey: `lesson_plans/${COACH}/portal_p.pdf`, lessonPlan: { assetId: 'a' } }, deps()))
      .toEqual({ status: 'invalid', reason: 'two_lesson_plans' });
  });

  test('the same recording sent twice returns the observation already started', async () => {
    const d = deps({ supabase: fakeSupabase({ users: () => coachRow(), coaching_sessions: () => ({ id: 'cs-earlier' }) }) });
    expect(await start({}, d)).toEqual({ status: 'ok', coachingSessionId: 'cs-earlier' });
    expect(d.supabase.writes.inserts).toEqual([]);
    expect(d.queue.queueTranscription).not.toHaveBeenCalled();
  });

  test('a queue failure never leaves the row parked at confirmed', async () => {
    const d = deps({ queue: { queueTranscription: jest.fn().mockRejectedValue(new Error('sqs down')) } });
    expect(await start({}, d)).toEqual({ status: 'queue_failed', coachingSessionId: SID });
    expect(d.supabase.writes.updates.find((u) => u.table === 'coaching_sessions').patch).toMatchObject({ status: 'failed', failed_step: 'queue' });
  });
});

describe('teacherRecentPlans — HER recent plans, not the coach\'s', () => {
  test('reads the WhatsApp recent list for the teacher', async () => {
    const d = deps();
    const out = await Svc.teacherRecentPlans({ userId: COACH, teacherExtId: ayesha.teacher_ext_id, schoolExtId: 'sch-1' }, d);
    expect(d.library.recent).toHaveBeenCalledWith(TEACHER_UID);
    expect(out).toMatchObject({ status: 'ok', plans: [{ assetId: 'a1', topic: 'Fractions', grade: 4 }] });
  });
  test('a teacher not yet on Rumi has none', async () => {
    const d = deps({ leaderSource: { resolveTeacher: jest.fn().mockResolvedValue({ ...ayesha, user_id: null }) } });
    expect(await Svc.teacherRecentPlans({ userId: COACH, teacherExtId: 'x' }, d)).toEqual({ status: 'ok', plans: [] });
  });
  test('not her teacher', async () => {
    const d = deps({ leaderSource: { resolveTeacher: jest.fn().mockResolvedValue(null) } });
    expect(await Svc.teacherRecentPlans({ userId: COACH, teacherExtId: 'x' }, d)).toEqual({ status: 'invalid', reason: 'not_your_teacher' });
  });
});

describe('only the observing coach, only a portal-started observation', () => {
  const calls = [
    ['observationView', {}],
    ['getDraft', {}],
    ['saveDraft', { edits: {} }],
    ['talkGuide', {}],
    ['startTalk', { key: KEY }],
    ['previewReport', {}],
    ['sendReport', {}],
  ];
  test.each(calls)('%s: another coach\'s observation is not found', async (fn, extra) => {
    const d = deps({ supabase: fakeSupabase({ users: () => coachRow(), coaching_sessions: () => obsRow({ observer_user_id: OTHER }) }) });
    expect(await Svc[fn]({ userId: COACH, coachingSessionId: SID, ...extra }, d)).toEqual({ status: 'not_found' });
  });
  // bd-15y1pc: she READS her WhatsApp observation in the portal (below); every
  // step that acts on it still happens on WhatsApp.
  const actions = calls.filter(([fn]) => !['observationView', 'getDraft'].includes(fn));
  test.each(actions)('%s: a WhatsApp-captured observation is not found here', async (fn, extra) => {
    const wa = 'https://r2.example/bucket/classroom_audio/u/2026-10/683335f3_1790852380454.ogg';
    const d = deps({ supabase: fakeSupabase({ users: () => coachRow(), coaching_sessions: () => obsRow({ audio_url: wa }) }) });
    expect(await Svc[fn]({ userId: COACH, coachingSessionId: SID, ...extra }, d)).toEqual({ status: 'not_found' });
  });
});

/**
 * bd-15y1pc — operator: "view the observation you did on the bot on the portal".
 * Her own observation reads the same from either side — the step, the form's
 * answers, the debrief guide and her feedback — whichever app it was captured
 * in. `portal` says whether the portal can also take it through its steps;
 * `editable` whether the form can still be changed here.
 */
describe('bd-15y1pc — her own observation reads the same from either side', () => {
  const WA = 'https://r2.example/bucket/classroom_audio/u/2026-10/683335f3_1790852380454.ogg';
  const withRow = (over) => deps({ supabase: fakeSupabase({ users: () => coachRow(), coaching_sessions: () => obsRow(over) }) });
  const feedback = { praise_line: 'p', wins: [], try: null, reflection_question: 'q' };

  test('observationView serves her WhatsApp observation: step, guide and feedback, marked not a portal one', async () => {
    const out = await Svc.observationView({ userId: COACH, coachingSessionId: SID }, withRow({
      audio_url: WA,
      status: 'completed',
      debrief_status: 'done',
      analysis_data: { observer_debrief: { feedback, guide_snapshot: { intro: 'g' } }, teacher_delivery: { status: 'sent' } },
    }));
    expect(out).toMatchObject({
      status: 'ok', step: 'done', portal: false,
      talk: { guide: { intro: 'g' }, feedback: { praise_line: 'p' } },
    });
  });

  test('observationView marks her portal observation as one the portal takes through its steps', async () => {
    expect(await Svc.observationView({ userId: COACH, coachingSessionId: SID }, withRow({}))).toMatchObject({ status: 'ok', portal: true });
  });

  test('getDraft serves her WhatsApp observation\'s form answers, read-only', async () => {
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, withRow({ audio_url: WA, status: 'awaiting_observer_review' }));
    expect(out).toMatchObject({ status: 'ok', editable: false });
    expect(out.sections.map((s) => s.key)).toEqual(['lesson_plan_fidelity', 'high_leverage_practices']);
  });

  test.each([
    ['the report is out', { debrief_status: 'done', analysis_data: { teacher_delivery: { status: 'sent' } } }],
    ['the observation is completed', { status: 'completed', debrief_status: 'done' }],
  ])('getDraft still reads the answers once %s — read-only', async (_why, over) => {
    expect(await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, withRow(over))).toMatchObject({ status: 'ok', editable: false });
  });

  test('getDraft of her portal observation awaiting her check is editable', async () => {
    expect(await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, withRow({ status: 'awaiting_observer_review' })))
      .toMatchObject({ status: 'ok', editable: true });
  });

  test('getDraft is still not ready before the analysis, from either side', async () => {
    expect(await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, withRow({ audio_url: WA, status: 'analyzing' })))
      .toMatchObject({ status: 'not_ready' });
  });
});

describe('the draft — the MEWAKA Flow\'s fields, the MEWAKA Flow\'s save', () => {
  const withRow = (over) => deps({ supabase: fakeSupabase({ users: () => coachRow(), coaching_sessions: () => obsRow(over) }) });

  test('getDraft serves each section the Flow serves, from buildScreenPrefill', async () => {
    const d = withRow({ status: 'awaiting_observer_review' });
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, d);
    expect(out.status).toBe('ok');
    expect(out.scale).toEqual([{ id: '0', title: '0 · Not observed' }, { id: 'na', title: '— N/A' }]);
    expect(out.sections).toEqual([
      {
        key: 'lesson_plan_fidelity', letter: 'B', title: 'Lesson Plan Fidelity', kind: 'moves',
        header: 'Measured 75%', fallback: '', moves: [{ k: 1, plan: 'Fold paper', verdict: 'executed', evidence: 'She folded it' }],
      },
      {
        key: 'high_leverage_practices', letter: 'C', title: 'High-Leverage Practices', kind: 'indicators', notes: [],
        indicators: [{ id: 'C1', field: 'C1', name: 'Quality Questioning', rating: '1', evidence: 'Asked facts', improvement: 'Ask why' }],
      },
    ]);
    expect(d.draft.buildScreenPrefill).toHaveBeenCalledWith(expect.any(Object), 'high_leverage_practices', 'en');
  });

  test('getDraft is not ready while the lesson is still being analysed', async () => {
    expect(await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, withRow({ status: 'analyzing' }))).toMatchObject({ status: 'not_ready' });
  });

  test('saveDraft applies exactly the Flow\'s edit keys through applyObserverEdits', async () => {
    const d = withRow({ status: 'awaiting_observer_review' });
    const out = await Svc.saveDraft({
      userId: COACH, coachingSessionId: SID,
      edits: { r_C1: '2', ev_C1: 'Asked why twice', imp_C1: 'Keep going', fid_r_1: 'partial', fid_e_1: 'x', userId: OTHER, status: 'completed', r_C2: 3 },
    }, d);
    expect(out).toEqual({ status: 'ok', summary: { indicators_rescored: 1, text_fields_changed: 0 } });
    expect(d.draft.applyObserverEdits).toHaveBeenCalledWith(SID, {
      r_C1: '2', ev_C1: 'Asked why twice', imp_C1: 'Keep going', fid_r_1: 'partial', fid_e_1: 'x',
    });
  });

  test('saveDraft is refused once the report has gone to the teacher', async () => {
    const d = withRow({ analysis_data: { teacher_delivery: { status: 'sent' } } });
    expect(await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: { r_C1: '2' } }, d)).toMatchObject({ status: 'not_ready' });
    expect(d.draft.applyObserverEdits).not.toHaveBeenCalled();
  });

  test('a cancel that lands mid-save is reported, never a success', async () => {
    const d = withRow({ status: 'awaiting_observer_review' });
    d.draft.applyObserverEdits.mockResolvedValue({ refused: 'terminal' });
    expect(await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: {} }, d)).toEqual({ status: 'not_ready', reason: 'terminal' });
  });
});

describe('the talk with the teacher', () => {
  const withRow = (over) => deps({ supabase: fakeSupabase({ users: () => coachRow(), coaching_sessions: () => obsRow(over) }) });

  test('talkGuide builds the guide startDebrief builds, once, and keeps it on the row', async () => {
    const d = withRow({});
    const out = await Svc.talkGuide({ userId: COACH, coachingSessionId: SID }, d);
    expect(out.status).toBe('ok');
    expect(out.guide.sections.strengths.title).toBe('S');
    expect(d.debrief.buildDebriefGuide).toHaveBeenCalledWith(expect.objectContaining({ id: SID }), 'en');
    expect(d.debrief.mergeObserverDebrief).toHaveBeenCalledWith(SID, { guide_snapshot: out.guide });
  });

  test('talkGuide returns the stored guide without another model call', async () => {
    const guide = { intro: 'stored', sections: {} };
    const d = withRow({ analysis_data: { observer_debrief: { guide_snapshot: guide } } });
    expect(await Svc.talkGuide({ userId: COACH, coachingSessionId: SID }, d)).toEqual({ status: 'ok', guide });
    expect(d.debrief.buildDebriefGuide).not.toHaveBeenCalled();
  });

  test('the guide waits for the draft to be checked', async () => {
    expect(await Svc.talkGuide({ userId: COACH, coachingSessionId: SID }, withRow({ status: 'awaiting_observer_review' })))
      .toMatchObject({ status: 'not_ready' });
  });

  test('startTalk attaches the portal recording with the WhatsApp fresh-recording reset and queues the debrief job', async () => {
    const talkKey = `classroom_audio/${COACH}/2026-10/portal_talk1.webm`;
    const guide = { intro: 'g' };
    const d = withRow({ analysis_data: { observer_debrief: { guide_snapshot: guide } } });
    const out = await Svc.startTalk({ userId: COACH, coachingSessionId: SID, key: talkKey }, d);
    expect(out).toEqual({ status: 'ok' });
    expect(d.debrief.freshRecordingPatch).toHaveBeenCalledWith({
      audioId: null, audioMime: 'audio/webm', guideSnapshot: guide, recordedAt: '2026-10-02T05:00:00.000Z',
    });
    expect(d.debrief.mergeObserverDebrief).toHaveBeenCalledWith(SID, expect.objectContaining({
      audio_id: null, audio_r2_key: talkKey, transcript: null, feedback: null,
      too_short_at: null, feedback_failed_at: null, duplicate_refused_at: null,
    }));
    const [sid, payload] = d.queue.queueObserveDebrief.mock.calls[0];
    expect(sid).toBe(SID);
    expect(payload).toMatchObject({ from: '923333232533' });
    expect(payload.dedupNonce).toMatch(/^[0-9a-f]{16}$/);
  });

  test('startTalk refuses someone else\'s upload, and a talk already coached', async () => {
    const d = withRow({});
    expect(await Svc.startTalk({ userId: COACH, coachingSessionId: SID, key: `classroom_audio/${OTHER}/2026-10/portal_t.webm` }, d))
      .toEqual({ status: 'invalid', reason: 'not_your_upload' });
    expect(await Svc.startTalk({ userId: COACH, coachingSessionId: SID, key: KEY }, withRow({ debrief_status: 'done' })))
      .toMatchObject({ status: 'not_ready' });
  });

  test('retryTalk re-queues a portal talk that failed, without a new recording', async () => {
    const d = withRow({ analysis_data: { observer_debrief: { audio_r2_key: 'k', transcript: 'long', feedback_failed_at: 't' } } });
    expect(await Svc.retryTalk({ userId: COACH, coachingSessionId: SID }, d)).toEqual({ status: 'ok' });
    expect(d.debrief.mergeObserverDebrief).toHaveBeenCalledWith(SID, { failed_at: null, feedback_failed_at: null, transcription_error: null, error_class: null });
    expect(d.queue.queueObserveDebrief).toHaveBeenCalled();
  });

  test('retryTalk will not re-run a recording that was too short — that needs a new one', async () => {
    const d = withRow({ analysis_data: { observer_debrief: { audio_r2_key: 'k', too_short_at: 't' } } });
    expect(await Svc.retryTalk({ userId: COACH, coachingSessionId: SID }, d)).toMatchObject({ status: 'not_ready' });
  });
});

describe('the report to the teacher', () => {
  const withRow = (over) => deps({ supabase: fakeSupabase({ users: () => coachRow(), coaching_sessions: () => obsRow(over) }) });

  test('previewReport records the bound teacher, marks the send as the portal\'s and queues the preview phase', async () => {
    const d = withRow({ debrief_status: 'done' });
    expect(await Svc.previewReport({ userId: COACH, coachingSessionId: SID }, d)).toEqual({ status: 'ok' });
    expect(d.roster.upsertTeacher).toHaveBeenCalledWith(expect.objectContaining({ id: COACH }), { name: 'Ayesha Bibi', phone: '923120004471' });
    expect(d.send.mergeTeacherDelivery).toHaveBeenCalledWith(SID, {
      teacher_name: 'Ayesha Bibi', teacher_phone: '923120004471', status: 'previewing', channel: 'portal', send_requested_at: null,
    });
    expect(d.queue.queueObserveTeacherReport).toHaveBeenCalledWith(SID, {
      from: '923333232533', phase: 'preview', channel: 'portal', dedupNonce: 'nonce-1',
    });
  });

  test('the report waits for her own feedback (debrief done), as on WhatsApp', async () => {
    expect(await Svc.previewReport({ userId: COACH, coachingSessionId: SID }, withRow({ debrief_status: 'pending' })))
      .toMatchObject({ status: 'not_ready' });
  });

  test('sendReport queues the deliver phase only for a rendered preview', async () => {
    const ready = withRow({ debrief_status: 'done', analysis_data: { teacher_delivery: { status: 'awaiting_confirm', report_key: 'observe-reports/x.png', teacher_phone: '923120004471' } } });
    expect(await Svc.sendReport({ userId: COACH, coachingSessionId: SID }, ready)).toEqual({ status: 'ok' });
    expect(ready.send.mergeTeacherDelivery).toHaveBeenCalledWith(SID, { send_requested_at: '2026-10-02T05:00:00.000Z', channel: 'portal' });
    expect(ready.queue.queueObserveTeacherReport).toHaveBeenCalledWith(SID, {
      from: '923333232533', phase: 'deliver', channel: 'portal', dedupNonce: 'nonce-1',
    });

    const notYet = withRow({ debrief_status: 'done', analysis_data: { teacher_delivery: { status: 'previewing' } } });
    expect(await Svc.sendReport({ userId: COACH, coachingSessionId: SID }, notYet)).toMatchObject({ status: 'not_ready' });
    expect(notYet.queue.queueObserveTeacherReport).not.toHaveBeenCalled();
  });
});

describe('observationView — what the observation page shows', () => {
  test('the step, the teacher, her feedback and a signed preview image', async () => {
    const feedback = { praise_line: 'p', wins: [{ behaviour: 'b', evidence: 'e' }], try: { move: 'm', evidence: 'e', instead: 'i' }, reflection_question: 'q', rubric: { disparaged_teacher: false } };
    const d = deps({ supabase: fakeSupabase({ users: () => coachRow(), coaching_sessions: () => obsRow({
      debrief_status: 'done',
      analysis_data: {
        observer_debrief: { feedback, guide_snapshot: { intro: 'g' } },
        teacher_delivery: { status: 'awaiting_confirm', report_key: 'observe-reports/cs.png', caption: 'cap', companion_text: 'comp', teacher_name: 'Ayesha Bibi', teacher_phone: '923120004471' },
        observer_edit_summary: { indicators_rescored: 2 },
      },
    }) }) });
    const out = await Svc.observationView({ userId: COACH, coachingSessionId: SID }, d);
    expect(out).toMatchObject({
      status: 'ok', id: SID, step: 'report', problem: null, preparing: false,
      teacher: { name: 'Ayesha Bibi', phone: '923120004471' },
      draft: { edited: true },
      talk: { guide: { intro: 'g' }, feedback: { praise_line: 'p', harmful: false } },
      report: { status: 'awaiting_confirm', caption: 'cap', companionText: 'comp', imageUrl: `${URL('observe-reports/cs.png')}?sig=1` },
    });
    expect(out.talk.feedback.rubric).toBeUndefined();
  });
});
