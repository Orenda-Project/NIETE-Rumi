/**
 * bd-fmf24g.76 — teacher v2 Digital Coaching sends NO class, and takes up to ten photos.
 *
 * No class. The WhatsApp path never asks a class: a session's subject comes from the signals on its row
 * (subject-resolution.js tiers 1-3, else "not confirmed"). A portal session started WITHOUT a teacherClass is
 * the same row, so it resolves by the same tiers. Pinned here by running the portal start for real and the
 * resolver on what it wrote, against the row a WhatsApp recording with the same plan would have.
 *
 * Ten photos. The portal DC start takes ten (MAX_DC_PHOTOS); the coach's observation start (portal-observe,
 * which imports MAX_PHOTOS) and the WhatsApp photo step (photo-capture-routing) stay at three.
 */
const SERVICE = '../../bot/shared/services/coaching/portal-coaching.service';
const USER = '1ff9fc2e-9b4a-48d4-94f3-312ad52df81b';
const key = `classroom_audio/${USER}/2026-10/portal_abc123.m4a`;

function fakeSupabase() {
  const writes = { inserts: [] };
  const from = (table) => {
    const q = {};
    q.select = () => q; q.eq = () => q; q.order = () => q; q.limit = () => q; q.update = () => q;
    q.insert = (row) => { writes.inserts.push({ table, row }); q._inserted = row; return q; };
    q.single = async () => (q._inserted
      ? { data: { id: 'cs-new', ...q._inserted }, error: null }
      : { data: table === 'users' ? { id: USER, phone_number: '923006657687' } : null, error: null });
    q.maybeSingle = async () => ({ data: null, error: null });
    q.then = (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej);
    return q;
  };
  return { from, writes };
}
const deps = (extra = {}) => ({
  supabase: fakeSupabase(),
  r2: {
    headObject: jest.fn().mockResolvedValue({ exists: true, sizeBytes: 1_000_000 }),
    buildR2PublicUrl: (k) => `https://r2.example/bucket/${k}`,
  },
  queue: { queueTranscription: jest.fn().mockResolvedValue('msg-1') },
  library: {
    readyRender: jest.fn(async () => ({ r2Key: `lesson_plans/${USER}/portal_render.pdf` })),
    resolveAsset: jest.fn(),
    link: jest.fn(),
  },
  log: jest.fn(),
  now: () => new Date('2026-10-12T10:00:00Z'),
  newId: () => 'abc123',
  ...extra,
});
const photoKeys = (n) => Array.from({ length: n }, (_, i) => `images/${USER}/portal_p${i}.jpg`);
const insertedRow = (d) => d.supabase.writes.inserts.find((w) => w.table === 'coaching_sessions').row;

describe('no class: the portal start writes the same row a WhatsApp recording has', () => {
  let Svc; let Resolve;
  beforeEach(() => { jest.resetModules(); Svc = require(SERVICE); Resolve = require('../../bot/shared/services/coaching/subject-resolution'); });

  test.each([['absent', undefined], ['null', null]])('teacherClass %s: accepted, and no teacher_class is written', async (_n, teacherClass) => {
    const d = deps();
    const out = await Svc.startPortalSession({ userId: USER, key, ...(teacherClass === undefined ? {} : { teacherClass }) }, d);
    expect(out).toMatchObject({ status: 'ok', coachingSessionId: 'cs-new' });
    expect(insertedRow(d).conversation_state.teacher_class).toBeUndefined();
    expect(d.log).not.toHaveBeenCalled(); // not a "pick dropped" warn: there was simply no pick
    expect(d.queue.queueTranscription).toHaveBeenCalled();
  });

  test('no class and no plan: the subject is "not confirmed", exactly as a WhatsApp recording with no signal', async () => {
    const d = deps();
    await Svc.startPortalSession({ userId: USER, key }, d);
    const portal = Resolve.resolveLessonSubject({ ...insertedRow(d), id: 'cs-new' });
    const whatsapp = Resolve.resolveLessonSubject({ id: 'wa', conversation_state: { current_state: 'TRANSCRIBING' } });
    expect(portal).toEqual({ code: null, grade: null, confidence: 'none', source: 'no_signal', group: null });
    expect(portal).toEqual(whatsapp);
  });

  test('no class, her own plan names the subject: tier 1 resolves it, the same as on WhatsApp', async () => {
    const d = deps();
    await Svc.startPortalSession({ userId: USER, key, lessonPlanKey: `lesson_plans/${USER}/portal_lp1.pdf` }, d);
    const lessonPlanStructured = { subject: 'Mathematics', grade_level: '4' };
    const portal = Resolve.resolveLessonSubject({ ...insertedRow(d), lesson_plan_structured: lessonPlanStructured });
    const whatsapp = Resolve.resolveLessonSubject({ conversation_state: {}, lesson_plan_structured: lessonPlanStructured });
    expect(portal).toMatchObject({ code: 'maths', grade: '4', confidence: 'high', source: 'lesson_plan_structured' });
    expect(portal).toEqual(whatsapp);
  });

  test('no class, a library plan: the corpus key resolves subject and grade (tier 2), as the WhatsApp list does', async () => {
    const stub = { _fidelity_ref: { lesson_id: 'grade_4_science_ch02_seg03' } }; // what the linker stashes
    const portal = Resolve.resolveLessonSubject({ conversation_state: {}, lesson_plan_structured: stub });
    expect(portal).toMatchObject({ code: 'science', grade: '4', confidence: 'medium', source: 'corpus_lesson_id' });
  });
});

describe('ten photos', () => {
  let Svc;
  beforeEach(() => { jest.resetModules(); Svc = require(SERVICE); });

  test('the portal DC start takes ten photos and stores all ten, in order', async () => {
    const d = deps();
    const out = await Svc.startPortalSession({ userId: USER, key, photoKeys: photoKeys(10) }, d);
    expect(out).toMatchObject({ status: 'ok' });
    expect(insertedRow(d).classroom_photos).toHaveLength(10);
    expect(insertedRow(d).classroom_photos[9].url).toBe(`https://r2.example/bucket/${photoKeys(10)[9]}`);
    expect(insertedRow(d).conversation_state.classroom_photos).toHaveLength(10);
  });

  test('an eleventh is refused before anything is written', async () => {
    const d = deps();
    expect(await Svc.startPortalSession({ userId: USER, key, photoKeys: photoKeys(11) }, d))
      .toEqual({ status: 'invalid', reason: 'too_many_photos' });
    expect(d.supabase.writes.inserts).toEqual([]);
  });

  test('the cap is its own constant: 10 for DC; the coach observation cap (MAX_PHOTOS) and the WhatsApp step stay 3', () => {
    expect(Svc.MAX_DC_PHOTOS).toBe(10);
    expect(Svc.MAX_PHOTOS).toBe(3);
    expect(require('../../bot/shared/services/coaching/photo-capture-routing').MAX_COACHING_PHOTOS).toBe(3);
  });
});
