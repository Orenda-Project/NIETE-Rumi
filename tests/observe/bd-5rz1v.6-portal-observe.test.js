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
    // bd-snkn32.41: her own Make my own plans — none unless a test gives some.
    ownPlans: { list: jest.fn().mockResolvedValue([]), resolveKey: jest.fn().mockResolvedValue(null), ...(over.ownPlans || {}) },
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
    state: { getState: jest.fn().mockResolvedValue(null), clearState: jest.fn().mockResolvedValue(true), ...(over.state || {}) },
    // bd-ra8xu.40: the rubric stamp at start — off by default (no switch on), as on WhatsApp.
    rubric: {
      decideV6: jest.fn().mockResolvedValue(null),
      fdeOn: jest.fn().mockResolvedValue(false),
      createLessonForm: jest.fn().mockResolvedValue({ ok: true, form: { id: 'form-1' } }),
      ...(over.rubric || {}),
    },
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

  // bd-r2uzg1.23.3 (queue #274, ICT sheet IAB Experience View 16; the operator 25 Nov: "On the max photos, make them
  // 10"): a coach's or principal's observation takes up to ten photos, as the teacher's own Digital Coaching does.
  test('ten board photos are taken and written, in the order she picked them', async () => {
    const d = deps();
    const photos = Array.from({ length: 10 }, (_, i) => `images/${COACH}/portal_ph${i}.jpg`);
    expect(await start({ photoKeys: photos }, d)).toEqual({ status: 'ok', coachingSessionId: SID });
    const insert = d.supabase.writes.inserts.find((w) => w.table === 'coaching_sessions');
    expect(insert.row.classroom_photos.map((p) => p.url)).toEqual(photos.map(URL));
  });

  test('four photos, which the old cap of three refused, are taken', async () => {
    const photos = [1, 2, 3, 4].map((i) => `images/${COACH}/portal_p${i}.jpg`);
    expect(await start({ photoKeys: photos }, deps())).toEqual({ status: 'ok', coachingSessionId: SID });
  });

  // bd-r2uzg1.23.5 (queue #274, call 6A; ICT sheet HITL 199): a principal's recording arrived as a 0-byte file, the
  // analysis was queued and failed three times, and the screen said "upload again". An empty recording is refused here.
  test('an empty recording (0 bytes) is refused before anything is written or queued', async () => {
    const d = deps({ r2: { headObject: jest.fn().mockResolvedValue({ exists: true, sizeBytes: 0 }) } });
    expect(await start({}, d)).toMatchObject({ status: 'invalid', reason: 'recording_empty' });
    expect(d.supabase.writes.inserts).toHaveLength(0);
    expect(d.queue.queueTranscription).not.toHaveBeenCalled();
  });

  test('refuses without a teacher at all — a portal observation is never unbound', async () => {
    const d = deps();
    expect(await start({ teacherExtId: '' }, d)).toEqual({ status: 'invalid', reason: 'no_teacher' });
  });

  test('refuses a missing upload, too many photos, and two plans', async () => {
    const missing = deps({ r2: { headObject: jest.fn().mockResolvedValue({ exists: false }) } });
    expect(await start({}, missing)).toMatchObject({ status: 'invalid', reason: 'upload_missing' });
    // bd-r2uzg1.23.3 (queue #274): the coach's and principal's cap is ten now; the eleventh is refused.
    const photos = Array.from({ length: 11 }, (_, i) => `images/${COACH}/portal_p${i}.jpg`);
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

  // bd-ewbzns.4.3 — a win's behaviour is a rubric key since the 3 Nov rubric: the view names it in both languages
  // (observe-strings coach_rubric_names) so the page can show the name in its own; free text has no name.
  test('observationView names each win in English and Urdu; a free-text behaviour has no name', async () => {
    const fb = { praise_line: 'p', wins: [{ behaviour: 'asked_and_waited', evidence: 'e1' }, { behaviour: 'Asked open questions', evidence: 'e2' }], try: null, reflection_question: 'q' };
    const out = await Svc.observationView({ userId: COACH, coachingSessionId: SID }, withRow({
      status: 'observer_review_complete', debrief_status: 'done', analysis_data: { observer_debrief: { feedback: fb } },
    }));
    expect(out.talk.feedback.wins).toEqual([
      { behaviour: 'asked_and_waited', evidence: 'e1', name: { en: 'Asked & waited', ur: 'سوال کے بعد انتظار' } },
      { behaviour: 'Asked open questions', evidence: 'e2', name: null },
    ]);
  });

  test('observationView marks her portal observation as one the portal takes through its steps', async () => {
    expect(await Svc.observationView({ userId: COACH, coachingSessionId: SID }, withRow({}))).toMatchObject({ status: 'ok', portal: true });
  });

  test('getDraft serves her WhatsApp observation\'s form answers — editable while awaiting her check (bd-gie5ep)', async () => {
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, withRow({ audio_url: WA, status: 'awaiting_observer_review' }));
    expect(out).toMatchObject({ status: 'ok', editable: true });
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

/**
 * bd-gie5ep — operator: "you can start an /observation from the bot and carry
 * it over in the portal". Her WhatsApp observation goes through every remaining
 * step here, through the same functions; and when the portal takes a step, a
 * WhatsApp chat still waiting on THAT observation is released, so an old
 * button or a stray voice note cannot act on it a second time.
 */
describe('bd-gie5ep — she continues her WhatsApp observation in the portal', () => {
  const WA = 'https://r2.example/bucket/classroom_audio/u/2026-10/683335f3_1790852380454.ogg';
  const TALK = `classroom_audio/${COACH}/2026-10/portal_talk1.webm`;
  const READY = { teacher_delivery: { status: 'awaiting_confirm', report_key: 'observe-reports/x.png', teacher_phone: '923120004471' } };
  const withRow = (over, extra = {}) => deps({
    supabase: fakeSupabase({ users: () => coachRow(), coaching_sessions: () => obsRow({ audio_url: WA, ...over }) }), ...extra,
  });

  test('saveDraft applies her edits through the review form\'s save', async () => {
    const d = withRow({ status: 'awaiting_observer_review' });
    expect(await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: { r_C1: '2', junk: 'x' } }, d)).toMatchObject({ status: 'ok' });
    expect(d.draft.applyObserverEdits).toHaveBeenCalledWith(SID, { r_C1: '2' });
  });

  test('startTalk attaches her portal recording and queues its coaching', async () => {
    const d = withRow({});
    expect(await Svc.startTalk({ userId: COACH, coachingSessionId: SID, key: TALK }, d)).toEqual({ status: 'ok' });
    expect(d.debrief.mergeObserverDebrief).toHaveBeenCalledWith(SID, expect.objectContaining({ audio_id: null, audio_r2_key: TALK }));
    expect(d.queue.queueObserveDebrief).toHaveBeenCalledWith(SID, expect.objectContaining({ from: '923333232533' }));
  });

  test('previewReport and sendReport run the report as the portal\'s', async () => {
    const p = withRow({ debrief_status: 'done' });
    expect(await Svc.previewReport({ userId: COACH, coachingSessionId: SID }, p)).toEqual({ status: 'ok' });
    expect(p.queue.queueObserveTeacherReport).toHaveBeenCalledWith(SID, expect.objectContaining({ phase: 'preview', channel: 'portal' }));
    const s = withRow({ debrief_status: 'done', analysis_data: READY });
    expect(await Svc.sendReport({ userId: COACH, coachingSessionId: SID }, s)).toEqual({ status: 'ok' });
    expect(s.queue.queueObserveTeacherReport).toHaveBeenCalledWith(SID, expect.objectContaining({ phase: 'deliver', channel: 'portal' }));
  });

  test.each([
    ['saveDraft', { status: 'awaiting_observer_review' }, { edits: {} }, 'awaiting_form'],
    ['startTalk', {}, { key: TALK }, 'awaiting_debrief_audio'],
    ['previewReport', { debrief_status: 'done' }, {}, 'awaiting_send_confirm'],
    ['sendReport', { debrief_status: 'done', analysis_data: READY }, {}, 'awaiting_send_confirm'],
  ])('%s releases a WhatsApp chat waiting on THIS observation', async (fn, over, extra, waiting) => {
    const d = withRow(over, { state: { getState: jest.fn().mockResolvedValue({ state: waiting, sessionId: SID }) } });
    expect(await Svc[fn]({ userId: COACH, coachingSessionId: SID, ...extra }, d)).toMatchObject({ status: 'ok' });
    expect(d.state.clearState).toHaveBeenCalledWith(COACH);
  });

  test('a step releases only its own WhatsApp step — saving the form leaves an armed debrief recording alone', async () => {
    const d = withRow({}, { state: { getState: jest.fn().mockResolvedValue({ state: 'awaiting_debrief_audio', sessionId: SID }) } });
    expect(await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: {} }, d)).toMatchObject({ status: 'ok' });
    expect(d.state.clearState).not.toHaveBeenCalled();
  });

  test.each(['awaiting_teacher_pick', 'awaiting_teacher_details'])('previewReport also releases the WhatsApp send flow\'s %s', async (waiting) => {
    const d = withRow({ debrief_status: 'done' }, { state: { getState: jest.fn().mockResolvedValue({ state: waiting, sessionId: SID }) } });
    expect(await Svc.previewReport({ userId: COACH, coachingSessionId: SID }, d)).toEqual({ status: 'ok' });
    expect(d.state.clearState).toHaveBeenCalledWith(COACH);
  });

  test('a WhatsApp chat waiting on ANOTHER observation is left alone', async () => {
    const d = withRow({}, { state: { getState: jest.fn().mockResolvedValue({ state: 'awaiting_debrief_audio', sessionId: 'cs-other' }) } });
    expect(await Svc.startTalk({ userId: COACH, coachingSessionId: SID, key: TALK }, d)).toEqual({ status: 'ok' });
    expect(d.state.clearState).not.toHaveBeenCalled();
  });

  test('a refused step releases nothing', async () => {
    const d = withRow({ debrief_status: 'pending' }, { state: { getState: jest.fn().mockResolvedValue({ state: 'awaiting_debrief_audio', sessionId: SID }) } });
    expect(await Svc.previewReport({ userId: COACH, coachingSessionId: SID }, d)).toMatchObject({ status: 'not_ready' });
    expect(d.state.clearState).not.toHaveBeenCalled();
  });

  test('a chat state that cannot be read never fails the step', async () => {
    const d = withRow({}, { state: { getState: jest.fn().mockRejectedValue(new Error('redis down')) } });
    expect(await Svc.startTalk({ userId: COACH, coachingSessionId: SID, key: TALK }, d)).toEqual({ status: 'ok' });
  });
});

/**
 * bd-fmf24g.66 — the observation page says what became of the plan the coach attached:
 * her own file (a portal upload, or the normalised copy the extraction worker writes), a library
 * plan, or none; and for her own file Reading / Read / Couldn't read, from the extraction status.
 * Only real fields: the topic is the one extraction found, never a made-up name.
 */
describe('observationView — lessonPlan (bd-fmf24g.66)', () => {
  const OWN_KEY = `lesson_plans/${COACH}/portal_9f2c.pdf`;
  const view = (over) => Svc.observationView({ userId: COACH, coachingSessionId: SID }, deps({
    supabase: fakeSupabase({ users: () => coachRow(), coaching_sessions: () => obsRow(over) }),
  }));

  test('no plan at all', async () => {
    expect((await view({ has_lesson_plan: false })).lessonPlan).toMatchObject({ source: 'none', format: null, state: null, topic: null, openable: false });
  });

  test.each([
    ['pending', 'reading'], [null, 'reading'], ['completed', 'read'],
    ['not_lesson_plan', 'unreadable'], ['failed', 'unreadable'], ['failed_bad_format', 'unreadable'],
  ])('her own file, extraction %s → %s', async (status, state) => {
    const out = await view({
      has_lesson_plan: status !== 'not_lesson_plan', lesson_plan_r2_key: OWN_KEY, lesson_plan_format: 'pdf',
      lesson_plan_extraction_status: status,
      lesson_plan_structured: status === 'completed' ? { topic: 'Place value & counting 4-digit numbers' } : null,
    });
    // bd-kijmb8 — plus openable / fileKind / title, the Lesson plan button's fields.
    expect(out.lessonPlan).toEqual({
      source: 'own', format: 'pdf', state, topic: status === 'completed' ? 'Place value & counting 4-digit numbers' : null,
      openable: true, fileKind: 'pdf', title: status === 'completed' ? 'Place value & counting 4-digit numbers' : null,
    });
  });

  test('the worker\'s normalised copy of her file is still her own file', async () => {
    const out = await view({
      has_lesson_plan: true, lesson_plan_r2_key: `lesson_plans/${TEACHER_UID}/${SID}_lesson_plan.docx`, lesson_plan_format: 'docx',
      lesson_plan_extraction_status: 'completed', lesson_plan_structured: { topic: 'T' },
    });
    expect(out.lessonPlan).toMatchObject({ source: 'own', format: 'docx', state: 'read' });
  });

  test('a library plan (a linked asset, or a written 6-12 lesson) is not her own file', async () => {
    const linked = await view({ has_lesson_plan: true, lesson_plan_link_method: 'selected_recent', lesson_plan_structured: { _fidelity_ref: { lesson_id: 'x' }, topic: 'Fractions' } });
    expect(linked.lessonPlan).toMatchObject({ source: 'library', state: null });
    const written = await view({ has_lesson_plan: true, lesson_plan_r2_key: 'lp612/seg1/en/lesson.pdf', lesson_plan_format: 'pdf', lesson_plan_extraction_status: 'completed' });
    expect(written.lessonPlan).toMatchObject({ source: 'library', state: null });
  });

  test('the older fields are untouched', async () => {
    const out = await view({ has_lesson_plan: true, lesson_plan_r2_key: OWN_KEY, lesson_plan_extraction_status: 'completed' });
    expect(out.lesson).toMatchObject({ hasLessonPlan: true });
  });
});


// bd-ra8xu.40 (operator 12 Nov: "We need these on the portal as well"): an observation started from the portal gets the
// SAME rubric stamp as one started on WhatsApp (observe-capture.startFromAudio): grades 1-5 → FICO17 v6 when the coach
// switch says so; grades 6-12 → FDE's tool when the obs612 switch is on and the coach named the class and subject; else
// today's rubric, with nothing written.
describe('startPortalObservation — the rubric stamp, as on WhatsApp (bd-ra8xu.40)', () => {
  const start = (args, d) => Svc.startPortalObservation({ userId: COACH, teacherExtId: ayesha.teacher_ext_id, schoolExtId: 'sch-1', key: KEY, ...args }, d);
  const leaderSupabase = () => fakeSupabase({ users: () => coachRow({ region: 'sihala' }), coaching_sessions: () => null });
  const sessionInsert = (d) => d.supabase.writes.inserts.find((w) => w.table === 'coaching_sessions').row;
  const sessionUpdates = (d) => d.supabase.writes.updates.filter((w) => w.table === 'coaching_sessions');

  test('both switches off: no stamp is written (byte-identical to before)', async () => {
    const d = deps({ supabase: leaderSupabase() });
    expect(await start({}, d)).toEqual({ status: 'ok', coachingSessionId: SID });
    const row = sessionInsert(d);
    expect(row).not.toHaveProperty('framework');
    expect(row).not.toHaveProperty('framework_selection_reason');
    expect(sessionUpdates(d)).toEqual([]);
    expect(d.rubric.createLessonForm).not.toHaveBeenCalled();
  });

  test('the coach switch says v6 for a grades 1-5 teacher: the row is stamped fico17_v6 before transcription', async () => {
    const order = [];
    const d = deps({ supabase: leaderSupabase(), rubric: { decideV6: jest.fn(async () => { order.push('decide'); return 'fico17_v6'; }) } });
    d.queue.queueTranscription.mockImplementation(async () => { order.push('queue'); });
    await start({}, d);
    expect(d.rubric.decideV6).toHaveBeenCalledWith({ userId: COACH, region: 'sihala', teacherUserId: TEACHER_UID, schoolExtId: 'sch-1' });
    expect(sessionInsert(d)).toMatchObject({ framework: 'fico17_v6', framework_selection_reason: 'coach_rubric_switch' });
    expect(order).toEqual(['decide', 'queue']);
  });

  test('FDE on and the coach named grades 1-5: v6 is decided by her answer (lessonIsPrimary), no FDE form', async () => {
    const d = deps({ supabase: leaderSupabase(), rubric: { fdeOn: jest.fn().mockResolvedValue(true), decideV6: jest.fn().mockResolvedValue('fico17_v6') } });
    await start({ lesson: { primary: true } }, d);
    // bd-hk2jm3: the visit (teacher + school picked) rides along, for its region (FDE is ICT's only).
    expect(d.rubric.fdeOn).toHaveBeenCalledWith(expect.objectContaining({ id: COACH, region: 'sihala' }), { teacherUserId: TEACHER_UID, schoolExtId: 'sch-1' });
    expect(d.rubric.decideV6).toHaveBeenCalledWith({ userId: COACH, region: 'sihala', teacherUserId: TEACHER_UID, schoolExtId: 'sch-1', lessonIsPrimary: true });
    expect(sessionInsert(d)).toMatchObject({ framework: 'fico17_v6' });
    expect(d.rubric.createLessonForm).not.toHaveBeenCalled();
  });

  // bd-o15qnr.40.7 (queue #229, the operator 23 Nov ~19:45: for 1-5 "it never asks a subject … Why is that?") — a grades
  // 1-5 lesson now comes with its real grade and subject (the Lesson Plan picker): the rubric is still FICO17 v6 (decided
  // by lessonIsPrimary, never FICO-S or FDE), and the class is kept on the row (analysis_data.observed_lesson).
  test('grades 1-5 with its grade and subject: v6 as before, the class kept on the row, never FICO-S', async () => {
    const d = deps({ supabase: leaderSupabase(), rubric: { fdeOn: jest.fn().mockResolvedValue(true), ficoSOn: jest.fn().mockResolvedValue(true), decideV6: jest.fn().mockResolvedValue('fico17_v6') } });
    await start({ lesson: { primary: true, grade: 3, subject: 'maths' } }, d);
    expect(d.rubric.decideV6).toHaveBeenCalledWith({ userId: COACH, region: 'sihala', teacherUserId: TEACHER_UID, schoolExtId: 'sch-1', lessonIsPrimary: true });
    expect(sessionInsert(d)).toMatchObject({ framework: 'fico17_v6', analysis_data: { observed_lesson: { grade: 3, subject: 'maths' } } });
    expect(d.rubric.createLessonForm).not.toHaveBeenCalled();
  });

  test('grades 1-5: a grade outside 1-5 or an unknown subject is dropped from the record, the lesson still v6', async () => {
    const d = deps({ supabase: leaderSupabase(), rubric: { fdeOn: jest.fn().mockResolvedValue(true), decideV6: jest.fn().mockResolvedValue('fico17_v6') } });
    await start({ lesson: { primary: true, grade: 9, subject: 'astrology' } }, d);
    expect(sessionInsert(d)).toMatchObject({ framework: 'fico17_v6' });
    expect(sessionInsert(d).analysis_data?.observed_lesson).toBeUndefined();
  });

  test('FDE on and a grade 7 Maths lesson: FDE form row made, session stamped obs612-msci-v1, no v6 decision, no WhatsApp', async () => {
    const order = [];
    const d = deps({
      supabase: leaderSupabase(),
      rubric: {
        fdeOn: jest.fn().mockResolvedValue(true),
        createLessonForm: jest.fn(async () => { order.push('form'); return { ok: true, form: { id: 'form-7' } }; }),
      },
    });
    d.queue.queueTranscription.mockImplementation(async () => { order.push('queue'); });
    expect(await start({ lesson: { grade: 7, subject: 'maths' } }, d)).toEqual({ status: 'ok', coachingSessionId: SID });
    expect(d.rubric.decideV6).not.toHaveBeenCalled();
    expect(d.rubric.createLessonForm).toHaveBeenCalledWith({
      observerUserId: COACH,
      teacherUserId: TEACHER_UID,
      sessionId: SID,
      rubricVersion: 'obs612-msci-v1',
      visitContext: expect.objectContaining({ grade: 7, subject: 'maths', via: 'observe', channel: 'portal', teacher_ext_id: ayesha.teacher_ext_id, school_ext_id: 'sch-1' }),
    });
    expect(sessionUpdates(d)).toContainEqual(expect.objectContaining({
      patch: { framework: 'obs612-msci-v1', framework_selection_reason: 'obs612_lesson' }, filters: { id: SID },
    }));
    expect(order).toEqual(['form', 'queue']);
  });

  test('grade 8 English → the English & Urdu tool, its sheet kept on the form', async () => {
    const d = deps({ supabase: leaderSupabase(), rubric: { fdeOn: jest.fn().mockResolvedValue(true) } });
    await start({ lesson: { grade: 8, subject: 'english' } }, d);
    const call = d.rubric.createLessonForm.mock.calls[0][0];
    expect(call.rubricVersion).toBe('obs612-enur-v1');
    expect(call.visitContext).toMatchObject({ grade: 8, subject: 'english', sheet: 'en' });
  });

  // bd-ra8xu.40 (operator 12 Nov ~11:00): grades 9-12 follow the FICO switch (no subject needed, no FDE form).
  test.each([[{ grade: 10 }], [{ grade: 12, subject: 'maths' }]])('FDE on and grade 9-12 %j: FICO, decided as a named FICO class', async (lesson) => {
    const d = deps({ supabase: leaderSupabase(), rubric: { fdeOn: jest.fn().mockResolvedValue(true), decideV6: jest.fn().mockResolvedValue('fico17_v6') } });
    expect(await start({ lesson }, d)).toEqual({ status: 'ok', coachingSessionId: SID });
    expect(d.rubric.decideV6).toHaveBeenCalledWith({ userId: COACH, region: 'sihala', teacherUserId: TEACHER_UID, schoolExtId: 'sch-1', lessonIsPrimary: true });
    expect(d.rubric.createLessonForm).not.toHaveBeenCalled();
    expect(sessionInsert(d)).toMatchObject({ framework: 'fico17_v6' });
  });

  test('the FDE form row could not be made: the visit goes on unstamped (today\'s path), never half-FDE', async () => {
    const d = deps({ supabase: leaderSupabase(), rubric: { fdeOn: jest.fn().mockResolvedValue(true), createLessonForm: jest.fn().mockResolvedValue({ ok: false }) } });
    expect(await start({ lesson: { grade: 8, subject: 'islamiat' } }, d)).toEqual({ status: 'ok', coachingSessionId: SID });
    expect(sessionUpdates(d).filter((u) => u.patch.framework)).toEqual([]);
    expect(d.queue.queueTranscription).toHaveBeenCalled();
  });

  test('a lesson the portal sent that is not a class refuses before anything is written', async () => {
    const d = deps({ supabase: leaderSupabase(), rubric: { fdeOn: jest.fn().mockResolvedValue(true) } });
    expect(await start({ lesson: { grade: 'x', subject: 'maths' } }, d)).toEqual({ status: 'invalid', reason: 'bad_lesson' });
    expect(await start({ lesson: { grade: 7, subject: 'astrology' } }, d)).toEqual({ status: 'invalid', reason: 'bad_lesson' });
    expect(await start({ lesson: { grade: 7 } }, d)).toEqual({ status: 'invalid', reason: 'bad_lesson' });
    expect(d.supabase.writes.inserts).toEqual([]);
  });

  test('FDE off: a lesson the portal sent anyway is ignored (the switch decides, as on WhatsApp)', async () => {
    const d = deps({ supabase: leaderSupabase(), rubric: { decideV6: jest.fn().mockResolvedValue(null) } });
    await start({ lesson: { grade: 7, subject: 'maths' } }, d);
    expect(d.rubric.createLessonForm).not.toHaveBeenCalled();
    expect(d.rubric.decideV6).toHaveBeenCalledWith({ userId: COACH, region: 'sihala', teacherUserId: TEACHER_UID, schoolExtId: 'sch-1' });
    expect(sessionInsert(d)).not.toHaveProperty('framework');
  });

  test('a stamp decision that throws costs nothing: today\'s path', async () => {
    const d = deps({ supabase: leaderSupabase(), rubric: { decideV6: jest.fn().mockRejectedValue(new Error('boom')), fdeOn: jest.fn().mockRejectedValue(new Error('boom')) } });
    expect(await start({}, d)).toEqual({ status: 'ok', coachingSessionId: SID });
    expect(sessionInsert(d)).not.toHaveProperty('framework');
  });
});

describe('lessonQuestion — whether the portal asks the class (bd-ra8xu.40)', () => {
  test('the FDE switch on for this coach: ask, with the 6-12 grades and the subject keys', async () => {
    const d = deps({ supabase: fakeSupabase({ users: () => coachRow({ region: 'sihala' }) }), rubric: { fdeOn: jest.fn().mockResolvedValue(true) } });
    const out = await Svc.lessonQuestion({ userId: COACH }, d);
    expect(out).toEqual({
      // bd-31ziu8: `rubric` says which grade 6-12 rubric the question is for ('fde' here: FICO-S is off).
      status: 'ok', ask: true, rubric: 'fde', grades: [6, 7, 8, 9, 10, 11, 12], subjectGrades: [6, 7, 8],
      subjects: ['english', 'urdu', 'maths', 'science', 'social_studies', 'islamiat', 'computer', 'other'],
    });
  });
  test('off, or not a school leader: no question', async () => {
    expect(await Svc.lessonQuestion({ userId: COACH }, deps({ supabase: fakeSupabase({ users: () => coachRow() }) }))).toEqual({ status: 'ok', ask: false });
    expect(await Svc.lessonQuestion({ userId: COACH }, deps({ supabase: fakeSupabase({ users: () => coachRow({ role: 'teacher' }) }), rubric: { fdeOn: jest.fn().mockResolvedValue(true) } }))).toEqual({ status: 'ok', ask: false });
  });
});

// Principals have the coach HITL rubric (FICO17 v6 / FDE) on WhatsApp only (operator, 15 Nov: "Principals can only
// ahve it on th Whatsapp bot"). A portal visit a principal starts stays on today's rubric even when the coach switches
// carry role:principal: no v6 stamp, no FDE form, no class question. Coaches are unchanged (the tests above).
describe('a principal on the portal: today\'s rubric, whatever the coach switches say', () => {
  const start = (args, d) => Svc.startPortalObservation({ userId: COACH, teacherExtId: ayesha.teacher_ext_id, schoolExtId: 'sch-1', key: KEY, ...args }, d);
  const principalSupabase = (role = 'principal') => fakeSupabase({ users: () => coachRow({ role, region: 'sihala' }), coaching_sessions: () => null });
  const sessionInsert = (d) => d.supabase.writes.inserts.find((w) => w.table === 'coaching_sessions').row;
  const switchesOn = () => ({ fdeOn: jest.fn().mockResolvedValue(true), decideV6: jest.fn().mockResolvedValue('fico17_v6') });

  test('no v6 stamp, the switches are not even asked', async () => {
    const d = deps({ supabase: principalSupabase(), rubric: switchesOn() });
    expect(await start({}, d)).toEqual({ status: 'ok', coachingSessionId: SID });
    expect(sessionInsert(d)).not.toHaveProperty('framework');
    expect(sessionInsert(d)).not.toHaveProperty('framework_selection_reason');
    expect(d.rubric.decideV6).not.toHaveBeenCalled();
    expect(d.rubric.fdeOn).not.toHaveBeenCalled();
  });

  test('a grade 7 Maths lesson sent anyway: no FDE form, no FDE stamp', async () => {
    const d = deps({ supabase: principalSupabase(), rubric: switchesOn() });
    expect(await start({ lesson: { grade: 7, subject: 'maths' } }, d)).toEqual({ status: 'ok', coachingSessionId: SID });
    expect(d.rubric.createLessonForm).not.toHaveBeenCalled();
    expect(d.supabase.writes.updates.filter((u) => u.table === 'coaching_sessions' && u.patch.framework)).toEqual([]);
    expect(sessionInsert(d)).not.toHaveProperty('framework');
  });

  test('a grades 1-5 lesson named: still no v6 stamp', async () => {
    const d = deps({ supabase: principalSupabase(), rubric: switchesOn() });
    await start({ lesson: { primary: true } }, d);
    expect(sessionInsert(d)).not.toHaveProperty('framework');
  });

  test('the same switches for a coach still stamp v6 (contrast)', async () => {
    const d = deps({ supabase: principalSupabase('coach'), rubric: switchesOn() });
    await start({}, d);
    expect(sessionInsert(d)).toMatchObject({ framework: 'fico17_v6', framework_selection_reason: 'coach_rubric_switch' });
  });

  test('Check and send asks a principal no class question', async () => {
    const d = deps({ supabase: fakeSupabase({ users: () => coachRow({ role: 'principal', region: 'sihala' }) }), rubric: { fdeOn: jest.fn().mockResolvedValue(true) } });
    expect(await Svc.lessonQuestion({ userId: COACH }, d)).toEqual({ status: 'ok', ask: false });
    expect(d.rubric.fdeOn).not.toHaveBeenCalled();
  });
});

// bd-412rly (operator, 17 Nov: "get the principal thingy live for her"): a principal the principal app is ON for
// (app_settings portal_principal_app names her: the test switch) gets the coach HITL rubric on the portal exactly as on
// WhatsApp: FICO17 v6 for grades 1-5 and 9-12, FDE's tool for 6-8, decided by the same coach switches (role:principal
// keys). Every other principal is unchanged (the block above): no stamp, no class question.
describe('a principal ON the principal app: the coach HITL rubric on the portal, as on WhatsApp', () => {
  const start = (args, d) => Svc.startPortalObservation({ userId: COACH, teacherExtId: ayesha.teacher_ext_id, schoolExtId: 'sch-1', key: KEY, ...args }, d);
  const OTHER_PRINCIPAL = 'c0ac0000-0000-4000-8000-0000000000ff';
  const onApp = (value) => fakeSupabase({
    users: () => coachRow({ role: 'principal', region: 'sihala' }),
    coaching_sessions: () => null,
    app_settings: (filters) => (filters.key === 'portal_principal_app' ? (value === undefined ? null : { value }) : null),
  });
  const sessionInsert = (d) => d.supabase.writes.inserts.find((w) => w.table === 'coaching_sessions').row;
  const switchesOn = () => ({ fdeOn: jest.fn().mockResolvedValue(true), decideV6: jest.fn().mockResolvedValue('fico17_v6') });

  test('the switch names her: a v6 stamp, decided by the coach switch exactly as for a coach', async () => {
    const d = deps({ supabase: onApp(JSON.stringify([OTHER_PRINCIPAL, COACH])), rubric: switchesOn() });
    expect(await start({}, d)).toEqual({ status: 'ok', coachingSessionId: SID });
    expect(d.rubric.decideV6).toHaveBeenCalledWith({ userId: COACH, region: 'sihala', teacherUserId: TEACHER_UID, schoolExtId: 'sch-1' });
    expect(sessionInsert(d)).toMatchObject({ framework: 'fico17_v6', framework_selection_reason: 'coach_rubric_switch' });
  });

  test('a grades 1-5 lesson named: v6, decided as a named FICO class', async () => {
    const d = deps({ supabase: onApp([COACH]), rubric: switchesOn() });
    await start({ lesson: { primary: true } }, d);
    expect(d.rubric.decideV6).toHaveBeenCalledWith({ userId: COACH, region: 'sihala', teacherUserId: TEACHER_UID, schoolExtId: 'sch-1', lessonIsPrimary: true });
    expect(sessionInsert(d)).toMatchObject({ framework: 'fico17_v6' });
  });

  test('grade 10: FICO (v6), no FDE form', async () => {
    const d = deps({ supabase: onApp([COACH]), rubric: switchesOn() });
    await start({ lesson: { grade: 10 } }, d);
    expect(d.rubric.createLessonForm).not.toHaveBeenCalled();
    expect(sessionInsert(d)).toMatchObject({ framework: 'fico17_v6' });
  });

  test('grade 7 Maths: FDE\'s tool — the form row and the stamp, as for a coach', async () => {
    const d = deps({ supabase: onApp([COACH]), rubric: switchesOn() });
    expect(await start({ lesson: { grade: 7, subject: 'maths' } }, d)).toEqual({ status: 'ok', coachingSessionId: SID });
    expect(d.rubric.decideV6).not.toHaveBeenCalled();
    expect(d.rubric.createLessonForm).toHaveBeenCalledWith(expect.objectContaining({
      observerUserId: COACH, teacherUserId: TEACHER_UID, rubricVersion: 'obs612-msci-v1',
      visitContext: expect.objectContaining({ grade: 7, subject: 'maths', via: 'observe', channel: 'portal' }),
    }));
    expect(d.supabase.writes.updates).toContainEqual(expect.objectContaining({
      table: 'coaching_sessions', patch: { framework: 'obs612-msci-v1', framework_selection_reason: 'obs612_lesson' },
    }));
  });

  test('the switch on for everyone (true): the portal opens the app for her, so the bot agrees', async () => {
    const d = deps({ supabase: onApp(true), rubric: switchesOn() });
    await start({}, d);
    expect(sessionInsert(d)).toMatchObject({ framework: 'fico17_v6' });
  });

  test('Check and send asks her the class (FDE\'s switch decides, as for a coach)', async () => {
    const d = deps({ supabase: onApp([COACH]), rubric: { fdeOn: jest.fn().mockResolvedValue(true) } });
    const out = await Svc.lessonQuestion({ userId: COACH }, d);
    expect(out).toMatchObject({ status: 'ok', ask: true, grades: [6, 7, 8, 9, 10, 11, 12], subjectGrades: [6, 7, 8] });
    expect(d.rubric.fdeOn).toHaveBeenCalledWith(expect.objectContaining({ id: COACH, role: 'principal' }));
  });

  test.each([
    ['the switch names another principal', [OTHER_PRINCIPAL]],
    ['no switch row', undefined],
    ['the switch says "teachers"', 'teachers'],
    ['a malformed value', '{nope'],
    ['an empty list', []],
  ])('%s: today\'s rubric, the coach switches not asked, no class question', async (_label, value) => {
    const d = deps({ supabase: onApp(value), rubric: switchesOn() });
    await start({ lesson: { grade: 7, subject: 'maths' } }, d);
    expect(sessionInsert(d)).not.toHaveProperty('framework');
    expect(d.rubric.decideV6).not.toHaveBeenCalled();
    expect(d.rubric.fdeOn).not.toHaveBeenCalled();
    expect(d.rubric.createLessonForm).not.toHaveBeenCalled();
    const q = deps({ supabase: onApp(value), rubric: { fdeOn: jest.fn().mockResolvedValue(true) } });
    expect(await Svc.lessonQuestion({ userId: COACH }, q)).toEqual({ status: 'ok', ask: false });
  });

  test('the switch read fails: today\'s rubric (fail-closed)', async () => {
    const sb = onApp([COACH]);
    const from = sb.from;
    sb.from = (table) => { if (table === 'app_settings') throw new Error('db down'); return from(table); };
    const d = deps({ supabase: sb, rubric: switchesOn() });
    expect(await start({}, d)).toEqual({ status: 'ok', coachingSessionId: SID });
    expect(sessionInsert(d)).not.toHaveProperty('framework');
    expect(d.rubric.decideV6).not.toHaveBeenCalled();
  });

  test('a coach is never asked about the principal switch (unchanged path)', async () => {
    const appSettings = jest.fn(() => null);
    const sb = fakeSupabase({ users: () => coachRow({ role: 'coach', region: 'sihala' }), coaching_sessions: () => null, app_settings: appSettings });
    const d = deps({ supabase: sb, rubric: switchesOn() });
    await start({}, d);
    expect(sessionInsert(d)).toMatchObject({ framework: 'fico17_v6' });
    expect(appSettings).not.toHaveBeenCalled();
    await Svc.lessonQuestion({ userId: COACH }, deps({ supabase: sb, rubric: switchesOn() }));
    expect(appSettings).not.toHaveBeenCalled();
  });
});

describe('principal-app-switch isOnPrincipalApp — the portal\'s rule for portal_principal_app', () => {
  const mod = () => require('../../bot/shared/services/observe/principal-app-switch');
  const isOnPrincipalApp = (...a) => mod().isOnPrincipalApp(...a);
  const sb = (row) => fakeSupabase({ app_settings: (f) => (f.key === 'portal_principal_app' ? row : null) });
  test('the key is the portal\'s', () => expect(mod().PRINCIPAL_APP_KEY).toBe('portal_principal_app'));
  test.each([
    [[COACH], true],
    [JSON.stringify([COACH]), true],
    [true, true],
    ['true', true],
    [' TRUE ', true],
    [[OTHER], false],
    [JSON.stringify([OTHER]), false],
    ['teachers', false],
    [false, false],
    [{ users: [COACH] }, false],
    [[7], false],
  ])('value %j -> %j', async (value, want) => {
    expect(await isOnPrincipalApp(sb({ value }), COACH)).toBe(want);
  });
  test('no row, no user, a thrown read: off', async () => {
    expect(await isOnPrincipalApp(sb(null), COACH)).toBe(false);
    expect(await isOnPrincipalApp(sb({ value: [COACH] }), null)).toBe(false);
    expect(await isOnPrincipalApp({ from: () => { throw new Error('x'); } }, COACH)).toBe(false);
  });
});

describe('role-features isPrincipalRole', () => {
  const { isPrincipalRole, observesOwnSchoolAtOnce } = require('../../bot/shared/config/role-features');
  test.each([['principal', true], [' Principal ', true], ['coach', false], ['teacher', false], ['', false], [null, false], [undefined, false], [7, false]])(
    '%j -> %j', (role, want) => {
      expect(isPrincipalRole(role)).toBe(want);
      expect(observesOwnSchoolAtOnce({ role })).toBe(want);
    });
});

/**
 * bd-o15qnr.39 (queue #204, the operator 22 Nov ~00:45: "Like the class recording, the debrief recording should also be
 * attached to play right there.") — the view carries a signed link to the debrief she recorded or attached in the portal
 * (observer_debrief.audio_r2_key), so the debrief page and the visit can play it in place. A WhatsApp debrief has only
 * Meta's media id (no stored copy): no link, and nothing else changes.
 */
describe('observationView — the debrief recording (bd-o15qnr.39)', () => {
  const TALK = `classroom_audio/${COACH}/2026-11/portal_talk9.webm`;
  const view = (debrief) => Svc.observationView({ userId: COACH, coachingSessionId: SID }, deps({
    supabase: fakeSupabase({ users: () => coachRow(), coaching_sessions: () => obsRow({
      debrief_status: 'processing', analysis_data: { observer_debrief: debrief },
    }) }),
  }));

  test('a portal debrief: talk.audioUrl is the signed link to her recording', async () => {
    const out = await view({ audio_r2_key: TALK, recorded_at: '2026-11-22T05:00:00Z', guide_snapshot: { intro: 'g' } });
    expect(out.talk.audioUrl).toBe(`${URL(TALK)}?sig=1`);
    expect(out.talk.recordedAt).toBe('2026-11-22T05:00:00Z');
  });

  test('a WhatsApp debrief (a media id only) and no debrief yet: no link', async () => {
    expect((await view({ audio_id: 'wamid-media-1', recorded_at: '2026-11-22T05:00:00Z' })).talk.audioUrl).toBeNull();
    expect((await view(undefined)).talk.audioUrl).toBeNull();
  });

  test('a link that cannot be signed leaves the page as it was (no link, no error)', async () => {
    const out = await Svc.observationView({ userId: COACH, coachingSessionId: SID }, deps({
      supabase: fakeSupabase({ users: () => coachRow(), coaching_sessions: () => obsRow({ analysis_data: { observer_debrief: { audio_r2_key: TALK } } }) }),
      r2: { getPresignedUrl: jest.fn().mockRejectedValue(new Error('r2 down')) },
    }));
    expect(out.status).toBe('ok');
    expect(out.talk.audioUrl).toBeNull();
  });
});
