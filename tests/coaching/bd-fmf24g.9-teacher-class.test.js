/**
 * bd-fmf24g.9 — the class a teacher picks in the v2 app is stored with her
 * Digital Coaching recording and is the subject source for scoring.
 *
 * PRECEDENCE (operator-approved 2026-10-09): her pick WINS over every other
 * signal (her uploaded plan, the corpus plan she linked, a recent download, the
 * grader's lesson_mismatch note — that note is about a PLAN, and her pick is not
 * a plan). When an independent signal strongly disagrees — her own uploaded plan
 * names another subject, or the analysis infers another one — the disagreement
 * is logged at warn and the pick STANDS. A subject the registry does not know
 * (Physics, Woodwork) is not a code, so it falls through to the other tiers
 * rather than being matched to a nearest neighbour.
 *
 * Where it lives: coaching_sessions.conversation_state.teacher_class — an
 * existing JSONB, no new column.
 */

const SUBJECT = '../../bot/shared/services/coaching/subject-resolution';
const SERVICE = '../../bot/shared/services/coaching/portal-coaching.service';

const pick = (over = {}) => ({ grade: 4, subject: 'Mathematics', subject_key: 'maths', picked_at: '2026-10-09T08:00:00.000Z', ...over });
const withPick = (extra = {}, over = {}) => ({ conversation_state: { teacher_class: pick(over) }, ...extra });

describe('resolveLessonSubject — the teacher pick is tier 0', () => {
  const { resolveLessonSubject } = require(SUBJECT);

  test('a pick alone resolves: source teacher, confidence high, grade from the pick, group from the code', () => {
    expect(resolveLessonSubject(withPick())).toEqual({
      code: 'maths', grade: '4', confidence: 'high', source: 'teacher', group: 'math',
    });
  });

  test('it beats her uploaded plan, the corpus ref and recent downloads', () => {
    const s = withPick({ lesson_plan_structured: { subject: 'Urdu', grade_level: '1', _fidelity_ref: { subject: 'urdu', grade: 1 } } });
    const out = resolveLessonSubject(s, { downloads: [{ subject: 'Urdu', grade: 1, created_at: new Date().toISOString() }] });
    expect(out).toMatchObject({ code: 'maths', grade: '4', source: 'teacher', confidence: 'high' });
  });

  test('the grader\'s lesson_mismatch note is about a PLAN and does not demote her pick', () => {
    const s = withPick({ analysis_data: { lp_fidelity: { moderators: { note: 'lesson_mismatch' } } }, lesson_plan_structured: { subject: 'Urdu' } });
    expect(resolveLessonSubject(s)).toMatchObject({ code: 'maths', source: 'teacher' });
  });

  test('the key wins when the label is in her language; the label is used when there is no key', () => {
    expect(resolveLessonSubject(withPick({}, { subject: 'ریاضی', subject_key: 'maths' })).code).toBe('maths');
    expect(resolveLessonSubject(withPick({}, { subject: 'General Science', subject_key: undefined })).code).toBe('science');
  });

  test('a subject the registry does not know falls through to the next tier — never a nearest match', () => {
    const s = withPick({ lesson_plan_structured: { subject: 'Urdu', grade_level: '9' } }, { subject: 'Physics', subject_key: 'physics', grade: 9 });
    expect(resolveLessonSubject(s)).toMatchObject({ code: 'urdu', source: 'lesson_plan_structured' });
    expect(resolveLessonSubject(withPick({}, { subject: 'Physics', subject_key: 'physics' }))).toMatchObject({ code: null, source: 'no_signal' });
  });

  test.each([
    ['no grade', { grade: null }],
    ['grade 0', { grade: 0 }],
    ['grade 13', { grade: 13 }],
    ['a fractional grade', { grade: 4.5 }],
    ['a string grade', { grade: 'four' }],
  ])('a pick with %s is not used', (_n, over) => {
    expect(resolveLessonSubject(withPick({ lesson_plan_structured: { subject: 'Urdu' } }, over))).toMatchObject({ source: 'lesson_plan_structured' });
  });

  test('a numeric-string grade ("4") is read as 4', () => {
    expect(resolveLessonSubject(withPick({}, { grade: '4' }))).toMatchObject({ code: 'maths', grade: '4', source: 'teacher' });
  });

  test('no pick: behaviour is exactly today\'s', () => {
    expect(resolveLessonSubject({ lesson_plan_structured: { subject: 'Urdu', grade_level: '1' } })).toMatchObject({ source: 'lesson_plan_structured' });
    expect(resolveLessonSubject({ conversation_state: { questions: [] } })).toMatchObject({ source: 'no_signal' });
  });
});

describe('subjectDisagreement — strong disagreement is reported, never acted on', () => {
  const { subjectDisagreement, resolveLessonSubject } = require(SUBJECT);
  const run = (session, opts) => subjectDisagreement(session, resolveLessonSubject(session), opts);

  test('her own uploaded plan names another subject → reported', () => {
    const out = run(withPick({ lesson_plan_structured: { subject: 'Urdu', grade_level: '4' } }));
    expect(out).toEqual({
      teacher: { code: 'maths', grade: '4' },
      against: [{ code: 'urdu', source: 'lesson_plan_structured', confidence: 'high' }],
    });
  });

  test('the analysis infers another subject → reported', () => {
    const out = run(withPick(), { inferredSubject: 'English' });
    expect(out.against).toEqual([{ code: 'english', source: 'analysis_inferred', confidence: 'inferred' }]);
  });

  test('agreement, a medium-only signal, an unknown inferred subject or no pick → null', () => {
    expect(run(withPick({ lesson_plan_structured: { subject: 'Maths' } }), { inferredSubject: 'Mathematics' })).toBeNull();
    expect(run(withPick({ lesson_plan_structured: { _fidelity_ref: { subject: 'urdu', grade: 4 } } }))).toBeNull();
    expect(run(withPick(), { inferredSubject: 'Woodwork' })).toBeNull();
    expect(run({ lesson_plan_structured: { subject: 'Urdu' } }, { inferredSubject: 'English' })).toBeNull();
  });
});

// ── the bot stores the pick ─────────────────────────────────────────────────

const USER = '1ff9fc2e-9b4a-48d4-94f3-312ad52df81b';
const KEY = `classroom_audio/${USER}/2026-10/portal_abc123.webm`;

function fakeSupabase() {
  const writes = { inserts: [] };
  const from = (table) => {
    const q = {};
    q.select = () => q; q.eq = () => q; q.order = () => q; q.limit = () => q;
    q.insert = (row) => { writes.inserts.push({ table, row }); q._inserted = row; return q; };
    q.update = () => q;
    q.single = async () => (q._inserted
      ? { data: { id: 'cs-new', ...q._inserted }, error: null }
      : { data: table === 'users' ? { id: USER, phone_number: '923006657687' } : null, error: null });
    q.maybeSingle = async () => ({ data: null, error: null });
    q.then = (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej);
    return q;
  };
  return { from, writes };
}
function deps() {
  return {
    supabase: fakeSupabase(),
    library: { resolveAsset: jest.fn(), readyRender: jest.fn(), link: jest.fn(), recent: jest.fn() },
    log: jest.fn(),
    r2: { getPresignedUploadUrl: jest.fn(), headObject: jest.fn().mockResolvedValue({ exists: true, sizeBytes: 1000 }), buildR2PublicUrl: (k) => `https://r2.example/${k}` },
    queue: { queueTranscription: jest.fn().mockResolvedValue('m') },
    reflective: {}, getUserLanguage: jest.fn().mockResolvedValue('en'),
    now: () => new Date('2026-10-09T08:00:00Z'), newId: () => 'abc123',
  };
}
const row = (d) => d.supabase.writes.inserts.find((w) => w.table === 'coaching_sessions').row;

describe('startPortalSession — stores the pick on the row', () => {
  let Svc;
  beforeEach(() => { jest.resetModules(); Svc = require(SERVICE); });

  test('a valid pick lands in conversation_state.teacher_class, next to the state the row already starts with', async () => {
    const d = deps();
    const out = await Svc.startPortalSession({ userId: USER, key: KEY, teacherClass: { grade: 4, subject: 'Mathematics', subjectKey: 'maths' } }, d);
    expect(out).toEqual({ status: 'ok', coachingSessionId: 'cs-new' });
    expect(row(d).conversation_state).toMatchObject({
      current_state: 'TRANSCRIBING',
      teacher_class: { grade: 4, subject: 'Mathematics', subject_key: 'maths', picked_at: '2026-10-09T08:00:00.000Z' },
    });
  });

  test('the stored pick is what the resolver reads', async () => {
    const d = deps();
    await Svc.startPortalSession({ userId: USER, key: KEY, teacherClass: { grade: 7, subject: 'General Science' } }, d);
    const { resolveLessonSubject } = require(SUBJECT);
    expect(resolveLessonSubject(row(d))).toMatchObject({ code: 'science', grade: '7', source: 'teacher' });
  });

  test('no pick → no teacher_class key at all (today\'s row, byte for byte)', async () => {
    const d = deps();
    await Svc.startPortalSession({ userId: USER, key: KEY }, d);
    expect('teacher_class' in row(d).conversation_state).toBe(false);
  });

  test.each([
    ['a non-object', 'maths'],
    ['an array', [4, 'maths']],
    ['grade out of range', { grade: 14, subject: 'Maths' }],
    ['no subject', { grade: 4 }],
    ['a blank subject', { grade: 4, subject: '   ' }],
    ['an over-long subject', { grade: 4, subject: 'x'.repeat(200) }],
  ])('%s is dropped with a warn; the recording still starts', async (_n, bad) => {
    const d = deps();
    const out = await Svc.startPortalSession({ userId: USER, key: KEY, teacherClass: bad }, d);
    expect(out.status).toBe('ok');
    expect('teacher_class' in row(d).conversation_state).toBe(false);
    expect(d.log).toHaveBeenCalledWith(expect.stringMatching(/teacher class/i), expect.anything(), 'warn');
  });

  test('only the named fields are kept — nothing else rides along', async () => {
    const d = deps();
    await Svc.startPortalSession({ userId: USER, key: KEY, teacherClass: { grade: 4, subject: 'Maths', userId: 'x', extra: { a: 1 } } }, d);
    expect(Object.keys(row(d).conversation_state.teacher_class).sort()).toEqual(['grade', 'picked_at', 'subject']);
  });
});

describe('the internal route carries the pick', () => {
  test('/coaching/start passes teacherClass to the service', async () => {
    jest.resetModules();
    process.env.INTERNAL_API_KEY = 'secret';
    const svc = { presignUpload: jest.fn(), startPortalSession: jest.fn().mockResolvedValue({ status: 'ok', coachingSessionId: 'cs-1' }), submitReflection: jest.fn(), recentLessonPlans: jest.fn() };
    jest.doMock(SERVICE, () => svc);
    const router = require('../../bot/shared/routes/internal-api.routes');
    const layer = router.stack.find((l) => l.route && l.route.path === '/coaching/start' && l.route.methods.post);
    const handlers = layer.route.stack.map((s) => s.handle);
    const req = { body: { userId: 'u1', key: 'k', teacherClass: { grade: 4, subject: 'Maths' } }, headers: { 'x-api-key': 'secret' }, path: '/coaching/start', ip: '127.0.0.1' };
    await new Promise((resolve) => {
      const res = { status() { return this; }, json() { resolve(); return this; } };
      const run = (i) => handlers[i](req, res, () => run(i + 1));
      run(0);
    });
    expect(svc.startPortalSession).toHaveBeenCalledWith(expect.objectContaining({ teacherClass: { grade: 4, subject: 'Maths' } }));
  });
});

describe('retryAnalysis keeps her pick', () => {
  test('the reset conversation_state carries teacher_class across', async () => {
    jest.resetModules();
    const updates = [];
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: () => {
        const q = {};
        q.select = () => q; q.eq = () => q;
        q.update = (p) => { updates.push(p); return q; };
        q.single = async () => ({ data: { id: 's1', transcript_text: 't', conversation_state: { teacher_class: pick(), questions: [{ a: 1 }] } }, error: null });
        q.then = (res) => Promise.resolve({ data: null, error: null }).then(res);
        return q;
      },
    }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    for (const m of ['coaching-session', 'transcription-processor', 'lesson-plan-processor', 'analysis-processor',
      'reflective-conversation', 'report-generator', 'coaching-job-queue', 'coaching-helpers']) {
      jest.doMock(`../../bot/shared/services/coaching/${m}.service`, () => ({}));
    }
    const Orch = require('../../bot/shared/services/coaching-orchestrator.service');
    Orch.queueAnalysis = jest.fn().mockResolvedValue(undefined);
    await Orch.retryAnalysis('s1', '92300');
    const reset = updates.find((u) => u.conversation_state);
    expect(reset.conversation_state.teacher_class).toEqual(pick());
    expect(reset.conversation_state.questions).toEqual([]);
  });
});
