/**
 * bd-lfzoz — a teacher's classroom recording, uploaded from the PORTAL.
 *
 * The portal service cannot run the bot's coaching code in-process: the queue
 * driver needs aws-sdk v2 and the reflection engine needs supabase-js, axios and
 * openai, none of which the portal installs (see
 * tests/portal/portal-reaches-bot-modules.test.js). So the portal asks the bot
 * over the internal API, and the bot does the work with its own code. This file
 * pins the bot side: bot/shared/services/coaching/portal-coaching.service.js.
 *
 * The portal row joins the SAME pipeline as a WhatsApp recording. What differs
 * is only how it starts:
 *   · the audio is already in R2 (audio_url set, no WhatsApp media id);
 *   · consent is the upload itself, so the row starts at 'confirmed' — there
 *     is no Yes/No button to wait on;
 *   · its key is portal_<id>, which is how the pipeline knows to keep the
 *     debrief off WhatsApp (no new column — see isPortalSession).
 */

const SERVICE = '../../bot/shared/services/coaching/portal-coaching.service';

const USER = '1ff9fc2e-9b4a-48d4-94f3-312ad52df81b';
const OTHER = '9a9a9a9a-0000-4000-8000-000000000000';

/** Records every insert/update; select answers come from `rows`. */
function fakeSupabase(rows = {}) {
  const writes = { inserts: [], updates: [] };
  const from = (table) => {
    const q = { _table: table, _filters: {} };
    q.select = () => q;
    q.eq = (c, v) => { q._filters[c] = v; return q; };
    q.order = () => q;
    q.limit = () => q;
    q.insert = (row) => { writes.inserts.push({ table, row }); q._inserted = row; return q; };
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
  const supabase = overrides.supabase || fakeSupabase({
    users: { id: USER, phone_number: '923006657687' },
    coaching_sessions: null,
  });
  return {
    supabase,
    r2: {
      getPresignedUploadUrl: jest.fn().mockResolvedValue('https://r2.example/put?sig=1'),
      headObject: jest.fn().mockResolvedValue({ exists: true, sizeBytes: 1_000_000 }),
      buildR2PublicUrl: (key) => `https://r2.example/bucket/${key}`,
      ...(overrides.r2 || {}),
    },
    queue: { queueTranscription: jest.fn().mockResolvedValue('msg-1'), ...(overrides.queue || {}) },
    reflective: overrides.reflective || { handleReflectiveResponse: jest.fn() },
    getUserLanguage: overrides.getUserLanguage || jest.fn().mockResolvedValue('ur'),
    now: () => new Date('2026-10-01T10:00:00Z'),
    newId: () => 'abc123',
  };
}

describe('bd-lfzoz — portal coaching upload (bot side)', () => {
  let Svc;
  beforeEach(() => { jest.resetModules(); Svc = require(SERVICE); });

  describe('presignUpload', () => {
    test('signs a PUT for an audio file under the teacher\'s own classroom_audio prefix', async () => {
      const d = deps();
      const out = await Svc.presignUpload(
        { userId: USER, filename: 'Period 3 maths.m4a', contentType: 'audio/mp4', sizeBytes: 31_000_000 }, d,
      );

      expect(out.status).toBe('ok');
      expect(out.key).toBe(`classroom_audio/${USER}/2026-10/portal_abc123.m4a`);
      expect(out.uploadUrl).toBe('https://r2.example/put?sig=1');
      expect(d.r2.getPresignedUploadUrl).toHaveBeenCalledWith(out.key, 'audio/mp4', expect.any(Number));
    });

    test('refuses a file that is not audio', async () => {
      const out = await Svc.presignUpload(
        { userId: USER, filename: 'lesson.pdf', contentType: 'application/pdf', sizeBytes: 1000 }, deps(),
      );
      expect(out).toMatchObject({ status: 'invalid', reason: 'not_audio' });
    });

    test('refuses a file over the size cap', async () => {
      const out = await Svc.presignUpload(
        { userId: USER, filename: 'a.mp3', contentType: 'audio/mpeg', sizeBytes: Svc.MAX_UPLOAD_BYTES + 1 }, deps(),
      );
      expect(out).toMatchObject({ status: 'invalid', reason: 'too_large' });
    });
  });

  describe('startPortalSession', () => {
    const key = `classroom_audio/${USER}/2026-10/portal_abc123.m4a`;

    test('creates a confirmed, portal-sourced row with the R2 url and queues transcription', async () => {
      const d = deps();
      const out = await Svc.startPortalSession({ userId: USER, key }, d);

      expect(out).toMatchObject({ status: 'ok', coachingSessionId: 'cs-new' });
      const ins = d.supabase.writes.inserts.find((w) => w.table === 'coaching_sessions');
      expect(ins.row).toMatchObject({
        user_id: USER,
        audio_url: `https://r2.example/bucket/${key}`,
        audio_id: null,
        status: 'confirmed',
      });
      expect(ins.row.source).toBeUndefined();              // no new column
      expect(Svc.isPortalSession(ins.row)).toBe(true);      // the key IS the marker
      expect(ins.row.observation_type).toBeUndefined();   // a teacher's own recording
      expect(ins.row.conversation_state.current_state).toBe('TRANSCRIBING');
      expect(d.queue.queueTranscription).toHaveBeenCalledWith('cs-new', { from: '923006657687' });
    });

    test('refuses a key that is not this teacher\'s own portal upload', async () => {
      const d = deps();
      const out = await Svc.startPortalSession(
        { userId: USER, key: `classroom_audio/${OTHER}/2026-10/portal_x.m4a` }, d,
      );
      expect(out).toMatchObject({ status: 'invalid', reason: 'not_your_upload' });
      expect(d.supabase.writes.inserts).toHaveLength(0);
      expect(d.queue.queueTranscription).not.toHaveBeenCalled();
    });

    test('refuses when the browser never finished the upload', async () => {
      const d = deps({ r2: { headObject: jest.fn().mockResolvedValue({ exists: false }) } });
      const out = await Svc.startPortalSession({ userId: USER, key }, d);
      expect(out).toMatchObject({ status: 'invalid', reason: 'upload_missing' });
      expect(d.supabase.writes.inserts).toHaveLength(0);
    });

    test('defers while another recording of hers is still being analysed — same rule as WhatsApp', async () => {
      const d = deps({
        supabase: fakeSupabase({
          users: { id: USER, phone_number: '923006657687' },
          coaching_sessions: { id: 'cs-old', status: 'analyzing', created_at: '2026-10-01T09:50:00Z' },
        }),
      });
      const out = await Svc.startPortalSession({ userId: USER, key }, d);
      expect(out).toMatchObject({ status: 'in_progress', coachingSessionId: 'cs-old' });
      expect(d.supabase.writes.inserts).toHaveLength(0);
    });

    test('a queue failure marks the new row failed instead of leaving it to rot at confirmed', async () => {
      const d = deps({ queue: { queueTranscription: jest.fn().mockRejectedValue(new Error('SQS down')) } });
      const out = await Svc.startPortalSession({ userId: USER, key }, d);
      expect(out).toMatchObject({ status: 'queue_failed' });
      const upd = d.supabase.writes.updates.find((w) => w.table === 'coaching_sessions');
      expect(upd.patch.status).toBe('failed');
    });
  });

  describe('attachments: lesson plan and classroom photos (collected in the portal)', () => {
    const key = `classroom_audio/${USER}/2026-10/portal_abc123.m4a`;
    const lpKey = `lesson_plans/${USER}/portal_lp1.pdf`;
    const photoKeys = [`images/${USER}/portal_ph1.jpg`, `images/${USER}/portal_ph2.png`];

    test('presign signs a lesson plan under lesson_plans/ and a photo under images/', async () => {
      const lp = await Svc.presignUpload({ userId: USER, filename: 'plan.PDF', sizeBytes: 100, kind: 'lesson_plan' }, deps());
      expect(lp).toMatchObject({ status: 'ok', key: `lesson_plans/${USER}/portal_abc123.pdf`, contentType: 'application/pdf' });
      const ph = await Svc.presignUpload({ userId: USER, filename: 'board.jpeg', sizeBytes: 100, kind: 'photo' }, deps());
      expect(ph).toMatchObject({ status: 'ok', key: `images/${USER}/portal_abc123.jpg`, contentType: 'image/jpeg' });
    });

    test('each kind accepts only its own file types', async () => {
      expect(await Svc.presignUpload({ userId: USER, filename: 'a.mp3', kind: 'lesson_plan' }, deps()))
        .toMatchObject({ status: 'invalid', reason: 'wrong_type' });
      expect(await Svc.presignUpload({ userId: USER, filename: 'a.pdf', kind: 'photo' }, deps()))
        .toMatchObject({ status: 'invalid', reason: 'wrong_type' });
      expect(await Svc.presignUpload({ userId: USER, filename: 'a.m4a', kind: 'video' }, deps()))
        .toMatchObject({ status: 'invalid', reason: 'unknown_kind' });
    });

    test('a lesson plan is written exactly as the WhatsApp upload writes it', async () => {
      const d = deps();
      await Svc.startPortalSession({ userId: USER, key, lessonPlanKey: lpKey }, d);
      const row = d.supabase.writes.inserts.find((w) => w.table === 'coaching_sessions').row;
      // lesson-plan-processor.handleLessonPlanUpload's write, field for field.
      expect(row).toMatchObject({
        has_lesson_plan: true,
        lesson_plan_url: `https://r2.example/bucket/${lpKey}`,
        lesson_plan_r2_key: lpKey,
        lesson_plan_format: 'pdf',
        lesson_plan_extraction_status: 'pending',
        lesson_plan_extraction_error: null,
      });
    });

    test('no lesson plan is written exactly as the WhatsApp "No" tap writes it', async () => {
      const d = deps();
      await Svc.startPortalSession({ userId: USER, key }, d);
      const row = d.supabase.writes.inserts.find((w) => w.table === 'coaching_sessions').row;
      expect(row).toMatchObject({ has_lesson_plan: false, lesson_plan_link_method: 'none' });
      expect(row.lesson_plan_r2_key).toBeUndefined();
    });

    test('photos land in classroom_photos (and its conversation_state mirror), in the WhatsApp record shape', async () => {
      const d = deps();
      await Svc.startPortalSession({ userId: USER, key, photoKeys }, d);
      const row = d.supabase.writes.inserts.find((w) => w.table === 'coaching_sessions').row;
      expect(row.classroom_photos).toEqual([
        { url: `https://r2.example/bucket/${photoKeys[0]}`, uploaded_at: '2026-10-01T10:00:00.000Z' },
        { url: `https://r2.example/bucket/${photoKeys[1]}`, uploaded_at: '2026-10-01T10:00:00.000Z' },
      ]);
      expect(row.conversation_state.classroom_photos).toEqual(row.classroom_photos);
    });

    test('an attachment over its own cap is refused (a 31 MB "photo")', async () => {
      const headObject = jest.fn(async (k) => ({ exists: true, sizeBytes: k.startsWith('images/') ? 31_000_000 : 1_000 }));
      const out = await Svc.startPortalSession({ userId: USER, key, photoKeys: [photoKeys[0]] }, deps({ r2: { headObject } }));
      expect(out).toMatchObject({ status: 'invalid', reason: 'too_large' });
    });

    test('more than three photos is refused (MAX_COACHING_PHOTOS)', async () => {
      const four = [1, 2, 3, 4].map((i) => `images/${USER}/portal_p${i}.jpg`);
      const out = await Svc.startPortalSession({ userId: USER, key, photoKeys: four }, deps());
      expect(out).toMatchObject({ status: 'invalid', reason: 'too_many_photos' });
    });

    test('an attachment that is not hers, or of the wrong kind, is refused before anything is written', async () => {
      for (const bad of [
        { lessonPlanKey: `lesson_plans/${OTHER}/portal_lp1.pdf` },
        { lessonPlanKey: `images/${USER}/portal_ph1.jpg` },
        { photoKeys: [`images/${OTHER}/portal_ph1.jpg`] },
        { photoKeys: [`classroom_audio/${USER}/2026-10/portal_abc123.m4a`] },
      ]) {
        const d = deps();
        const out = await Svc.startPortalSession({ userId: USER, key, ...bad }, d);
        expect(out).toMatchObject({ status: 'invalid', reason: 'not_your_upload' });
        expect(d.supabase.writes.inserts).toHaveLength(0);
      }
    });

    test('an attachment the browser never finished uploading is refused', async () => {
      const headObject = jest.fn(async (k) => ({ exists: !k.startsWith('lesson_plans/'), sizeBytes: 10 }));
      const d = deps({ r2: { headObject } });
      const out = await Svc.startPortalSession({ userId: USER, key, lessonPlanKey: lpKey }, d);
      expect(out).toMatchObject({ status: 'invalid', reason: 'upload_missing' });
    });
  });

  describe('afterTranscription — the step that replaces the WhatsApp photo/LP prompts', () => {
    test('with a lesson plan: extraction, then analysis — the WhatsApp upload order (FIFO per session)', async () => {
      const calls = [];
      const queue = {
        queueLessonPlanExtraction: jest.fn(async () => calls.push('extract')),
        queueAnalysis: jest.fn(async () => calls.push('analyse')),
      };
      await Svc.afterTranscription(
        { id: 'cs-1', user_id: USER, has_lesson_plan: true, lesson_plan_r2_key: 'lesson_plans/u/portal_x.pdf', lesson_plan_format: 'pdf' },
        'cs-1', '923006657687', { queue },
      );
      expect(calls).toEqual(['extract', 'analyse']);
      expect(queue.queueLessonPlanExtraction).toHaveBeenCalledWith('cs-1',
        { r2Key: 'lesson_plans/u/portal_x.pdf', fileType: 'pdf', userId: USER });
      expect(queue.queueAnalysis).toHaveBeenCalledWith('cs-1', { from: '923006657687', lpUploaded: true });
    });

    test('without a lesson plan: analysis only — the WhatsApp "No" order', async () => {
      const queue = { queueLessonPlanExtraction: jest.fn(), queueAnalysis: jest.fn() };
      await Svc.afterTranscription({ id: 'cs-1', user_id: USER, has_lesson_plan: false }, 'cs-1', '9230', { queue });
      expect(queue.queueLessonPlanExtraction).not.toHaveBeenCalled();
      expect(queue.queueAnalysis).toHaveBeenCalledWith('cs-1', { from: '9230' });
    });
  });

  describe('submitReflection', () => {
    const portalRow = (over = {}) => ({
      id: 'cs-9', user_id: USER, audio_url: 'https://r2.example/digital-coach-audio/classroom_audio/u/2026-10/portal_abc123.m4a', status: 'conducting_conversation', ...over,
    });

    test('runs the SAME reflection engine in silent mode and returns its acknowledgement', async () => {
      const handleReflectiveResponse = jest.fn().mockResolvedValue({ done: true, acknowledgement: 'Thank you.' });
      const d = deps({
        supabase: fakeSupabase({ coaching_sessions: portalRow(), users: { id: USER, phone_number: '923006657687' } }),
        reflective: { handleReflectiveResponse },
      });

      const out = await Svc.submitReflection({ userId: USER, coachingSessionId: 'cs-9', answer: ' I paused on purpose. ' }, d);

      expect(out).toMatchObject({ status: 'ok', done: true, acknowledgement: 'Thank you.' });
      expect(handleReflectiveResponse).toHaveBeenCalledWith(
        'cs-9', '923006657687', 'I paused on purpose.', 'text', 'ur', { silent: true },
      );
    });

    test('refuses another teacher\'s session', async () => {
      const d = deps({ supabase: fakeSupabase({ coaching_sessions: portalRow({ user_id: OTHER }) }) });
      const out = await Svc.submitReflection({ userId: USER, coachingSessionId: 'cs-9', answer: 'x' }, d);
      expect(out.status).toBe('not_found');
      expect(d.reflective.handleReflectiveResponse).not.toHaveBeenCalled();
    });

    test('refuses a WhatsApp session — its debrief belongs to the chat', async () => {
      const d = deps({ supabase: fakeSupabase({ coaching_sessions: portalRow({ audio_url: 'https://r2.example/digital-coach-audio/classroom_audio/u/2026-10/683335f3-9041-45eb_1790852380454.ogg' }) }) });
      const out = await Svc.submitReflection({ userId: USER, coachingSessionId: 'cs-9', answer: 'x' }, d);
      expect(out.status).toBe('not_found');
    });

    test('refuses when the question has not been asked yet (or was already answered)', async () => {
      const d = deps({ supabase: fakeSupabase({ coaching_sessions: portalRow({ status: 'analyzing' }) }) });
      const out = await Svc.submitReflection({ userId: USER, coachingSessionId: 'cs-9', answer: 'x' }, d);
      expect(out.status).toBe('not_ready');
    });

    test('refuses an empty answer', async () => {
      const d = deps({ supabase: fakeSupabase({ coaching_sessions: portalRow() }) });
      const out = await Svc.submitReflection({ userId: USER, coachingSessionId: 'cs-9', answer: '   ' }, d);
      expect(out.status).toBe('invalid');
    });
  });

  test('isPortalSession reads the R2 key: portal_<id> is portal, a WhatsApp key is not', () => {
    expect(Svc.isPortalSession({ audio_url: 'https://r2.example/digital-coach-audio/classroom_audio/u/2026-10/portal_abc123.m4a' })).toBe(true);
    expect(Svc.isPortalSession({ audio_url: 'https://r2.example/digital-coach-audio/classroom_audio/u/2026-10/portal_abc123.m4a?X-Amz-Signature=abc' })).toBe(true);
    expect(Svc.isPortalSession({ audio_url: 'https://r2.example/digital-coach-audio/classroom_audio/u/2026-10/683335f3-9041-45eb_1790852380454.ogg' })).toBe(false);   // the shape of all 441 sandbox rows
    expect(Svc.isPortalSession({ audio_url: null })).toBe(false);    // WhatsApp row before transcription
    expect(Svc.isPortalSession({})).toBe(false);
    expect(Svc.isPortalSession(null)).toBe(false);
    // The key the service BUILDS must be one the predicate RECOGNISES.
    const key = Svc.buildUploadKey('u', '.m4a', new Date('2026-10-01T00:00:00Z'), 'f47ac10b-58cc-4372');
    expect(Svc.isPortalSession({ audio_url: `https://r2.example/b/${key}` })).toBe(true);
  });
});
