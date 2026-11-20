'use strict';
/**
 * bd-ra8xu.60 — Observation Notes on the coach portal (bot side of the portal API).
 *
 *   lessonQuestion          also answers observationNotes: whether Record and Check and send show the notes box for her
 *   startPortalObservation  takes the notes typed on Record (each with the recording clock) and on Check and send, and
 *                           writes them on the new row itself (analysis_data.observation_notes), only for a visit stamped
 *                           FICO17 v6 while the switch is on; anything else is dropped. No race: the row is new.
 *   getDraft (v6)           returns them for the review form, word for word, and stamps the first opening of an
 *                           editable review (notes saved after it are flagged).
 * Harness: tests/observe/bd-5rz1v.6-portal-observe.test.js (dependency injection, Supabase faked).
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
    notesOn: over.notesOn || jest.fn().mockResolvedValue(true),
    observationNotes: over.observationNotes || { ...require('../../bot/shared/services/observe/observation-notes'), markReviewOpened: jest.fn().mockResolvedValue({ ok: true }) },
    log: jest.fn(),
    now: () => new Date('2026-10-02T05:00:00Z'),
    newId: () => 'nonce-1',
  };
}


let Svc;
beforeEach(() => { jest.resetModules(); Svc = require(SVC); });

const NOTES_IN = [
  { text: 'Board work: she asked each child how', rec_time: '12:40', source: 'portal_record', typed_at: '2026-10-02T04:52:00.000Z' },
  { text: 'Back rows silent', recTime: 1085, source: 'portal_record', typed_at: '2026-10-02T04:57:00.000Z' },
  { text: 'Groups: one child did it all', source: 'portal_check' },
  { text: '   ' },
];
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const start = (args, d) => Svc.startPortalObservation({ userId: COACH, teacherExtId: ayesha.teacher_ext_id, schoolExtId: 'sch-1', key: KEY, ...args }, d);
const inserted = (d) => d.supabase.writes.inserts.find((w) => w.table === 'coaching_sessions').row;

describe('startPortalObservation with notes', () => {
  test('a v6 visit with the switch on: the notes are on the new row, numbered, typed before the review', async () => {
    const d = deps({ rubric: { decideV6: jest.fn().mockResolvedValue('fico17_v6') } });
    const out = await start({ notes: NOTES_IN }, d);
    expect(out).toEqual({ status: 'ok', coachingSessionId: SID });
    const row = inserted(d);
    expect(row.framework).toBe('fico17_v6');
    expect(row.analysis_data).toEqual({
      observation_notes: [
        { id: 'n1', text: 'Board work: she asked each child how', typed_at: '2026-10-02T04:52:00.000Z', rec_time: '12:40', source: 'portal_record', typed_before_review: true, batch: `portal:${KEY}` },
        { id: 'n2', text: 'Back rows silent', typed_at: '2026-10-02T04:57:00.000Z', rec_time: '18:05', source: 'portal_record', typed_before_review: true, batch: `portal:${KEY}` },
        { id: 'n3', text: 'Groups: one child did it all', typed_at: '2026-10-02T05:00:00.000Z', rec_time: null, source: 'portal_check', typed_before_review: true, batch: `portal:${KEY}` },
      ],
    });
  });

  test('not a v6 visit, or the switch off: the notes are dropped and the row is today\'s', async () => {
    const notV6 = deps();
    await start({ notes: NOTES_IN }, notV6);
    expect(Object.keys(inserted(notV6))).not.toContain('analysis_data');
    const off = deps({ rubric: { decideV6: jest.fn().mockResolvedValue('fico17_v6') }, notesOn: jest.fn().mockResolvedValue(false) });
    await start({ notes: NOTES_IN }, off);
    expect(Object.keys(inserted(off))).not.toContain('analysis_data');
  });

  test('no notes sent: the row is today\'s, and the switch is not even read', async () => {
    const d = deps({ rubric: { decideV6: jest.fn().mockResolvedValue('fico17_v6') } });
    await start({}, d);
    expect(Object.keys(inserted(d))).not.toContain('analysis_data');
    expect(d.notesOn).not.toHaveBeenCalled();
  });
});

describe('lessonQuestion tells the portal whether to show the notes box', () => {
  test('on for her', async () => {
    const out = await Svc.lessonQuestion({ userId: COACH }, deps());
    expect(out).toMatchObject({ status: 'ok', observationNotes: true });
  });
  test('off for her', async () => {
    const out = await Svc.lessonQuestion({ userId: COACH }, deps({ notesOn: jest.fn().mockResolvedValue(false) }));
    expect(out).toEqual({ status: 'ok', ask: false }); // byte-identical to before while the switch is off
  });
});

describe('getDraft of a v6 visit', () => {
  const v6Row = (over = {}) => obsRow({
    framework: 'fico17_v6', status: 'awaiting_observer_review',
    analysis_data: {
      framework: 'fico17_v6', rubric: 'fico17_v6', levels: {}, domains: {},
      observation_notes: [
        { id: 'n1', text: 'Board work', rec_time: '12:40', source: 'portal_record', typed_before_review: true },
        { id: 'n2', text: 'Back rows silent', rec_time: null, source: 'whatsapp', typed_before_review: false },
      ],
    },
    ...over,
  });
  const withRow = (row, over = {}) => deps({ supabase: fakeSupabase({ users: () => coachRow(), coaching_sessions: () => row }), ...over });

  test('returns the notes word for word, with the recording clock, and stamps the first opening', async () => {
    const d = withRow(v6Row());
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, d);
    expect(out.status).toBe('ok');
    expect(out.kind).toBe('fico17_v6');
    expect(out.notes).toEqual([{ text: 'Board work', recTime: '12:40' }, { text: 'Back rows silent', recTime: null }]);
    await flush(); // the stamp runs beside the response
    expect(d.observationNotes.markReviewOpened).toHaveBeenCalledWith(SID);
  });

  test('a review already stamped is not stamped again; with the switch off nothing is stamped', async () => {
    const seen = v6Row();
    seen.analysis_data.observation_notes_review_opened_at = '2026-10-02T04:58:00.000Z';
    const saved = withRow(seen);
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, saved);
    expect(out.notes).toHaveLength(2);
    await flush();
    expect(saved.observationNotes.markReviewOpened).not.toHaveBeenCalled();
    const off = withRow(v6Row(), { notesOn: jest.fn().mockResolvedValue(false) });
    await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, off);
    await flush();
    expect(off.observationNotes.markReviewOpened).not.toHaveBeenCalled();
  });

  test('a v6 visit with no notes: notes is an empty list', async () => {
    const d = withRow(v6Row({ analysis_data: { framework: 'fico17_v6', rubric: 'fico17_v6', levels: {}, domains: {} } }));
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, d);
    expect(out.notes).toEqual([]);
  });
});
