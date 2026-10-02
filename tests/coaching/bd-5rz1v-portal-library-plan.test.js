/**
 * bd-5rz1v — a portal recording whose lesson plan was picked from the LIBRARY.
 *
 * The teacher can attach her plan three ways from the portal: a file / photo
 * she uploads (bd-lfzoz, unchanged), one of her recent plans, or any lesson in
 * the library. A library pick must reach the pipeline EXACTLY as the WhatsApp
 * "Recent Lesson Plans" list does — so the link is made by the same linker
 * (lp_select_<assetId>_<sessionId>), never by a second copy of its writes:
 *
 *   · grades 1-5   — the lesson resolves to the teacher's own A/B-group asset in
 *                    niete_lp_assets, and that asset id is linked;
 *   · grades 6-12  — there is no asset to link (the WhatsApp list cannot offer
 *                    these either). A lesson that has been WRITTEN has a PDF in
 *                    R2, and it is attached as if she had uploaded that PDF, so
 *                    it takes the existing extraction → analysis path. An
 *                    unwritten lesson is refused before anything is created.
 */

const SERVICE = '../../bot/shared/services/coaching/portal-coaching.service';

const USER = '1ff9fc2e-9b4a-48d4-94f3-312ad52df81b';
const KEY = `classroom_audio/${USER}/2026-10/portal_abc123.webm`;
const ASSET = '6d1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b';
const RENDER_KEY = 'lp612/renders/g7-sci-ch2-s3/ur/t4.pdf';

/** Records every insert/update in call order; select answers come from `rows`. */
function fakeSupabase(rows = {}, order = []) {
  const writes = { inserts: [], updates: [] };
  const from = (table) => {
    const q = { _table: table, _filters: {} };
    q.select = () => q;
    q.eq = (c, v) => { q._filters[c] = v; return q; };
    q.order = () => q;
    q.limit = () => q;
    q.insert = (row) => { writes.inserts.push({ table, row }); order.push(`insert:${table}`); q._inserted = row; return q; };
    q.update = (patch) => { writes.updates.push({ table, patch, filters: q._filters }); return q; };
    q.single = async () => {
      if (q._inserted) return { data: { id: 'cs-new', ...q._inserted }, error: null };
      const r = rows[table];
      const data = typeof r === 'function' ? r(q._filters) : (r ?? null);
      return { data, error: data ? null : { code: 'PGRST116' } };
    };
    q.maybeSingle = async () => {
      const r = rows[table];
      return { data: typeof r === 'function' ? r(q._filters) : (r ?? null), error: null };
    };
    q.then = (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej);
    return q;
  };
  return { from, writes };
}

function deps(overrides = {}) {
  const order = [];
  const supabase = fakeSupabase({
    users: { id: USER, phone_number: '923006657687' },
    coaching_sessions: null,
  }, order);
  const library = {
    resolveAsset: jest.fn().mockResolvedValue({ assetId: ASSET }),
    readyRender: jest.fn().mockResolvedValue({ r2Key: RENDER_KEY }),
    link: jest.fn(async (sessionId, assetId) => {
      order.push(`link:${sessionId}:${assetId}`);
      return { lesson_plan_link_method: 'selected_recent' };
    }),
    recent: jest.fn().mockResolvedValue([]),
    ...(overrides.library || {}),
  };
  return {
    order,
    supabase,
    library,
    log: jest.fn(),
    r2: {
      getPresignedUploadUrl: jest.fn(),
      headObject: jest.fn().mockResolvedValue({ exists: true, sizeBytes: 1_000_000 }),
      buildR2PublicUrl: (key) => `https://r2.example/bucket/${key}`,
    },
    queue: {
      queueTranscription: jest.fn(async () => { order.push('queue:transcription'); return 'msg-1'; }),
    },
    reflective: { handleReflectiveResponse: jest.fn() },
    getUserLanguage: jest.fn().mockResolvedValue('ur'),
    now: () => new Date('2026-10-02T10:00:00Z'),
    newId: () => 'abc123',
  };
}

const inserted = (d) => d.supabase.writes.inserts.find((w) => w.table === 'coaching_sessions');

describe('bd-5rz1v — startPortalSession with a library lesson plan', () => {
  let Svc;
  beforeEach(() => { jest.resetModules(); Svc = require(SERVICE); });

  test('grades 1-5: a library lesson is resolved to her asset and linked by the WhatsApp linker, before transcription is queued', async () => {
    const d = deps();
    const out = await Svc.startPortalSession(
      { userId: USER, key: KEY, lessonPlan: { lessonId: 'g4-sst-ch3-seg2' } }, d,
    );

    expect(out).toEqual({ status: 'ok', coachingSessionId: 'cs-new' });
    expect(d.library.resolveAsset).toHaveBeenCalledWith({ userId: USER, lessonId: 'g4-sst-ch3-seg2' });
    // The row starts with no plan; the linker writes the link, as on WhatsApp.
    expect(inserted(d).row).toMatchObject({ has_lesson_plan: false, lesson_plan_link_method: 'none' });
    expect(inserted(d).row.lesson_plan_r2_key).toBeUndefined();
    expect(d.order).toEqual(['insert:coaching_sessions', `link:cs-new:${ASSET}`, 'queue:transcription']);
  });

  test('a recent plan (her own downloaded asset) is linked by its asset id', async () => {
    const d = deps();
    const out = await Svc.startPortalSession({ userId: USER, key: KEY, lessonPlan: { assetId: ASSET } }, d);

    expect(out.status).toBe('ok');
    expect(d.library.resolveAsset).toHaveBeenCalledWith({ userId: USER, assetId: ASSET });
    expect(d.library.link).toHaveBeenCalledWith('cs-new', ASSET);
  });

  test('a library lesson with no asset is refused and nothing is created', async () => {
    const d = deps({ library: { resolveAsset: jest.fn().mockResolvedValue(null) } });
    const out = await Svc.startPortalSession({ userId: USER, key: KEY, lessonPlan: { lessonId: 'nope' } }, d);

    expect(out).toEqual({ status: 'invalid', reason: 'plan_not_found' });
    expect(d.supabase.writes.inserts).toHaveLength(0);
    expect(d.queue.queueTranscription).not.toHaveBeenCalled();
  });

  test('a linker failure never strands the recording: it is analysed without a plan, as the WhatsApp list degrades', async () => {
    const d = deps({ library: { link: jest.fn().mockRejectedValue(new Error('db down')) } });
    const out = await Svc.startPortalSession({ userId: USER, key: KEY, lessonPlan: { lessonId: 'g4-sst-ch3-seg2' } }, d);

    expect(out).toEqual({ status: 'ok', coachingSessionId: 'cs-new' });
    expect(d.queue.queueTranscription).toHaveBeenCalled();
    expect(d.log).toHaveBeenCalled();
  });

  test('grades 6-12: a written lesson\'s PDF is attached as an uploaded plan, so extraction runs as for any upload', async () => {
    const d = deps();
    const out = await Svc.startPortalSession(
      { userId: USER, key: KEY, lessonPlan: { segmentId: 'g7-sci-ch2-s3', lang: 'ur' } }, d,
    );

    expect(out.status).toBe('ok');
    expect(d.library.readyRender).toHaveBeenCalledWith({ segmentId: 'g7-sci-ch2-s3', lang: 'ur' });
    expect(inserted(d).row).toMatchObject({
      has_lesson_plan: true,
      lesson_plan_r2_key: RENDER_KEY,
      lesson_plan_url: `https://r2.example/bucket/${RENDER_KEY}`,
      lesson_plan_format: 'pdf',
      lesson_plan_extraction_status: 'pending',
    });
    expect(d.library.link).not.toHaveBeenCalled();
  });

  test('grades 6-12: a lesson that has not been written yet is refused before anything is created', async () => {
    const d = deps({ library: { readyRender: jest.fn().mockResolvedValue(null) } });
    const out = await Svc.startPortalSession(
      { userId: USER, key: KEY, lessonPlan: { segmentId: 'g7-sci-ch2-s3', lang: 'ur' } }, d,
    );

    expect(out).toEqual({ status: 'invalid', reason: 'plan_not_ready' });
    expect(d.supabase.writes.inserts).toHaveLength(0);
  });

  test('an uploaded plan AND a library plan together is refused — one lesson has one plan', async () => {
    const d = deps();
    const out = await Svc.startPortalSession({
      userId: USER, key: KEY,
      lessonPlanKey: `lesson_plans/${USER}/portal_x1.pdf`,
      lessonPlan: { assetId: ASSET },
    }, d);

    expect(out).toEqual({ status: 'invalid', reason: 'two_lesson_plans' });
    expect(d.supabase.writes.inserts).toHaveLength(0);
  });

  test.each([
    [{}],
    [{ assetId: '' }],
    [{ segmentId: 'g7', lang: 'fr' }],
    [{ assetId: ASSET, lessonId: 'g4' }],
    ['g4-sst'],
  ])('a malformed library pick %j is refused', async (lessonPlan) => {
    const d = deps();
    const out = await Svc.startPortalSession({ userId: USER, key: KEY, lessonPlan }, d);
    expect(out).toEqual({ status: 'invalid', reason: 'bad_lesson_plan' });
    expect(d.supabase.writes.inserts).toHaveLength(0);
  });

  test('no plan at all still starts exactly as before', async () => {
    const d = deps();
    const out = await Svc.startPortalSession({ userId: USER, key: KEY }, d);
    expect(out.status).toBe('ok');
    expect(d.library.resolveAsset).not.toHaveBeenCalled();
    expect(d.library.readyRender).not.toHaveBeenCalled();
    expect(inserted(d).row).toMatchObject({ has_lesson_plan: false, lesson_plan_link_method: 'none' });
  });
});

describe('bd-5rz1v — afterTranscription for a library-linked plan', () => {
  let Svc;
  beforeEach(() => { jest.resetModules(); Svc = require(SERVICE); });

  test('a linked library asset (no file to extract) goes straight to analysis — the WhatsApp lp_select path', async () => {
    const queue = { queueLessonPlanExtraction: jest.fn(), queueAnalysis: jest.fn() };
    const out = await Svc.afterTranscription(
      { has_lesson_plan: true, lesson_plan_link_method: 'selected_recent', lesson_plan_r2_key: null, user_id: USER },
      'cs-1', '923006657687', { queue },
    );
    expect(out).toEqual({ action: 'analysis' });
    expect(queue.queueLessonPlanExtraction).not.toHaveBeenCalled();
    expect(queue.queueAnalysis).toHaveBeenCalledWith('cs-1', { from: '923006657687' });
  });
});

describe('bd-5rz1v — recentLessonPlans', () => {
  let Svc;
  beforeEach(() => { jest.resetModules(); Svc = require(SERVICE); });

  test('returns the same recent plans the WhatsApp list offers her, in the portal\'s shape', async () => {
    const d = deps({
      library: {
        recent: jest.fn().mockResolvedValue([{
          id: ASSET, asset_id: ASSET, lesson_id: 'g4-sst-ch3-seg2', version_stamp: 'v8', content_hash: 'h',
          topic: 'Provinces of Pakistan', grade: '4', subject: 'Social Studies', chapter_number: 3,
          day_label: 'Day 2', pages_label: 'pp. 24-26', created_at: '2026-10-01T08:00:00Z',
        }]),
      },
    });
    const out = await Svc.recentLessonPlans({ userId: USER }, d);

    expect(d.library.recent).toHaveBeenCalledWith(USER);
    expect(out).toEqual({
      status: 'ok',
      plans: [{
        assetId: ASSET, lessonId: 'g4-sst-ch3-seg2', topic: 'Provinces of Pakistan', grade: '4',
        subject: 'Social Studies', chapterNumber: 3, dayLabel: 'Day 2', pagesLabel: 'pp. 24-26',
        downloadedAt: '2026-10-01T08:00:00Z',
      }],
    });
  });

  test('refuses without a user', async () => {
    expect(await Svc.recentLessonPlans({}, deps())).toEqual({ status: 'invalid', reason: 'no_user' });
  });
});
