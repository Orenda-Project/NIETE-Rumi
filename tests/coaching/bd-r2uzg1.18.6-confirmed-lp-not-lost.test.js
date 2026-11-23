'use strict';
/**
 * bd-r2uzg1.18.6 — the coach picks the teacher's lesson plan in /observe, taps Yes, and the report still
 * leaves Section B (lesson-plan fidelity) unmarked, as if no plan was given. Two ways it was lost (prod, 28 Oct):
 *
 *   1. A database hiccup (PostgREST "schema cache", PGRST002) on the pick. The linker read the error as
 *      "not a library plan", the legacy fallback failed the same way, and it answered link_method 'none'.
 *      The coach was told the analysis runs without a plan, and it did.
 *   2. A classroom photo sent as a Document at the plan step was read as a plan upload. Its "not a lesson
 *      plan" verdict landed two seconds AFTER the confirmed link and wrote has_lesson_plan=false and
 *      lesson_plan_structured=null over it, wiping the pick's fidelity ref.
 *
 * Contract:
 *   - the linker retries a database error; if it does not clear, it throws (LP_LINK_DB_ERROR) and never
 *     answers 'none' for a pick. A plan id found in neither table still continues without a plan, as before.
 *   - the list handler then tells the coach to tap Yes again and queues no analysis.
 *   - a not-a-plan verdict never clears a confirmed list pick (and the teacher is not told her pick failed).
 *   - once a list plan is confirmed, a photo (image or image sent as a document) at the plan step is kept as
 *     a classroom photo, not read as a plan. A PDF or Word file still goes to the plan reader, as before.
 */

const SID = '0e1d2c3b-4a59-4687-9a6b-5c4d3e2f1a00';
const ASSET = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';
const FROM = '920000000000';
const LESSON = 'grade_4_science_ch4_seg3';
const DB_DOWN = { code: 'PGRST002', message: 'Could not query the database for the schema cache. Retrying.' };

const silentLogger = () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn(), logInfo: jest.fn() });

// A scripted PostgREST stand-in: each read/write takes the next scripted answer for its table.
function dbMock(script) {
  const calls = { updates: [] };
  const take = (arr, dflt) => (arr && arr.length ? arr.shift() : dflt);
  const client = {
    from(table) {
      const b = {};
      let patch = null;
      ['select', 'eq', 'order', 'limit', 'neq', 'is', 'in', 'or', 'not'].forEach((m) => { b[m] = () => b; });
      b.update = (p) => { patch = p; return b; };
      b.maybeSingle = async () => (table === 'niete_lp_assets'
        ? take(script.assets, { data: null, error: null })
        : take(script.sessionReads, { data: { lesson_plan_structured: null }, error: null }));
      b.single = async () => take(script.lessonPlans, { data: null, error: { code: 'PGRST116', message: 'no rows' } });
      b.then = (resolve, reject) => {
        const r = patch ? take(script.updates, { data: null, error: null }) : { data: null, error: null };
        if (patch) calls.updates.push({ table, patch, error: r.error || null });
        return Promise.resolve(r).then(resolve, reject);
      };
      return b;
    },
  };
  return { client, calls };
}

describe('linker: a database error on a pick is retried, then stops loudly (cause 1)', () => {
  function load(script) {
    jest.resetModules();
    const db = dbMock(script);
    jest.doMock('../../bot/shared/config/supabase', () => db.client);
    jest.doMock('../../bot/shared/utils/logger', silentLogger);
    const linker = require('../../bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service');
    return { linker, db, sleep: jest.fn(async () => {}) };
  }
  afterEach(() => {
    jest.dontMock('../../bot/shared/config/supabase');
    jest.dontMock('../../bot/shared/utils/logger');
    jest.resetModules();
  });

  const assetRow = { data: { lesson_id: LESSON, version_stamp: 'v1', content_hash: 'h1' }, error: null };

  test('the plan is linked once the database answers again', async () => {
    const { linker, db, sleep } = load({ assets: [{ data: null, error: DB_DOWN }, { data: null, error: DB_DOWN }, assetRow] });
    const r = await linker.handleLPSelection(SID, `lp_select_${ASSET}_${SID}`, { sleep });
    expect(r.lesson_plan_link_method).toBe('selected_recent');
    expect(r.fidelity_ref.lesson_id).toBe(LESSON);
    expect(sleep).toHaveBeenCalledTimes(2);
    const linked = db.calls.updates.find((u) => u.patch.lesson_plan_link_method === 'selected_recent');
    expect(linked.patch.lesson_plan_structured._fidelity_ref.lesson_id).toBe(LESSON);
  });

  test('an error that does not clear throws — never "none" after a pick', async () => {
    const { linker, db, sleep } = load({ assets: [{ data: null, error: DB_DOWN }, { data: null, error: DB_DOWN }, { data: null, error: DB_DOWN }] });
    await expect(linker.handleLPSelection(SID, `lp_select_${ASSET}_${SID}`, { sleep }))
      .rejects.toMatchObject({ code: 'LP_LINK_DB_ERROR' });
    expect(db.calls.updates.filter((u) => u.patch.lesson_plan_link_method === 'none')).toEqual([]);
  });

  test('the legacy lesson_plans lookup failing on a database error also throws', async () => {
    const { linker, sleep } = load({
      assets: [{ data: null, error: null }],
      lessonPlans: [{ data: null, error: DB_DOWN }, { data: null, error: DB_DOWN }, { data: null, error: DB_DOWN }],
    });
    await expect(linker.handleLPSelection(SID, `lp_select_${ASSET}_${SID}`, { sleep }))
      .rejects.toMatchObject({ code: 'LP_LINK_DB_ERROR' });
  });

  test('a link write the database refuses is retried and never reported as linked', async () => {
    const { linker, sleep } = load({ assets: [assetRow], updates: [{ error: DB_DOWN }, { error: DB_DOWN }, { error: DB_DOWN }] });
    await expect(linker.handleLPSelection(SID, `lp_select_${ASSET}_${SID}`, { sleep }))
      .rejects.toMatchObject({ code: 'LP_LINK_DB_ERROR' });
  });

  test('a write refused once, then accepted, links the plan', async () => {
    const { linker, sleep } = load({ assets: [assetRow], updates: [{ error: DB_DOWN }] });
    const r = await linker.handleLPSelection(SID, `lp_select_${ASSET}_${SID}`, { sleep });
    expect(r.lesson_plan_link_method).toBe('selected_recent');
  });

  test('an id in neither table still continues without a plan (unchanged)', async () => {
    const { linker, sleep } = load({ assets: [{ data: null, error: null }] });
    const r = await linker.handleLPSelection(SID, `lp_select_${ASSET}_${SID}`, { sleep });
    expect(r.lesson_plan_link_method).toBe('none');
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('list handler: a failed link asks the coach to tap Yes again (cause 1)', () => {
  const { handleLpListSelection } = require('../../bot/shared/services/coaching/lp-coaching/lp-list-selection.handler');
  const { getCoachingMessage, COACHING_MESSAGES } = require('../../bot/shared/config/coaching-messages');

  function deps() {
    const sent = []; const queued = [];
    const err = Object.assign(new Error('db down'), { code: 'LP_LINK_DB_ERROR' });
    return {
      sent, queued,
      linker: { handleLPSelection: async () => { throw err; } },
      sendMessage: async (to, text) => { sent.push(text); },
      queueAnalysis: async (sid, payload) => { queued.push({ sid, payload }); },
      deferLpOutcome: async () => ({}),
      resolveLanguage: async () => 'ur',
      sessionStatus: async () => 'awaiting_lesson_plan',
      confirmed: true,
    };
  }

  test('the confirmed pick is not dropped: "try again", no analysis queued', async () => {
    const d = deps();
    expect(await handleLpListSelection(`lp_select_${ASSET}_${SID}`, FROM, d)).toBe(true);
    expect(d.sent).toEqual([getCoachingMessage('lessonPlan_link_failed', 'ur')]);
    expect(d.queued).toEqual([]);
  });

  test('the message is in English and Urdu, and short', () => {
    const m = COACHING_MESSAGES.lessonPlan_link_failed;
    expect(m.en).toMatch(/try again|tap \*Yes\* again/i);
    expect(m.ur).toMatch(/[؀-ۿ]/);
    expect(m.ur).toContain(getCoachingMessage('lessonPlan_confirm_yes', 'ur'));
    for (const lang of ['en', 'ur']) expect([...m[lang]].length).toBeLessThan(160);
    expect(m.en).not.toMatch(/\bapp\b/i);
  });
});

describe('extraction worker: a not-a-plan verdict never clears a confirmed pick (cause 2)', () => {
  const NOT_LP = { is_lesson_plan: false, subject: '', objectives: [] };
  let updates;

  function load(linkRow) {
    jest.resetModules();
    updates = [];
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: (table) => {
        const b = {
          select: () => b, eq: () => b, neq: () => b, is: () => b, or: () => b,
          single: async () => ({ data: { user_id: 'teacher-1', lesson_plan_url: 'u', lesson_plan_r2_key: 'lesson_plans/t/s_lesson_plan.jpg', lesson_plan_format: 'jpg' }, error: null }),
          maybeSingle: async () => ({ data: { user_id: 'teacher-1', ...linkRow }, error: null }),
          update: (payload) => { updates.push({ table, payload }); return b; },
        };
        return b;
      },
    }));
    jest.doMock('../../bot/shared/storage/r2', () => ({
      downloadFromR2: async () => Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      uploadLessonPlanBuffer: async () => 'k', buildR2PublicUrl: () => 'u',
    }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => true) }));
    // The model is never called here (parseWithGPT4oMini is stubbed below); keep the SDK out of the load.
    jest.doMock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({}) }));
    const Worker = require('../../bot/workers/lesson-plan-extraction.worker');
    jest.spyOn(Worker, 'extractText').mockResolvedValue({ text: 'A classroom photo: rows of desks, a whiteboard, children sitting and writing.', parser: 'vision:image' });
    jest.spyOn(Worker, 'parseWithGPT4oMini').mockResolvedValue(NOT_LP);
    const notify = jest.spyOn(Worker, 'notifyNotLessonPlan').mockResolvedValue();
    return { Worker, notify };
  }
  afterEach(() => {
    jest.dontMock('../../bot/shared/config/supabase');
    jest.dontMock('../../bot/shared/storage/r2');
    jest.dontMock('../../bot/shared/services/whatsapp.service');
    jest.dontMock('../../bot/shared/services/llm-client');
    jest.restoreAllMocks();
    jest.resetModules();
  });

  const job = { coachingSessionId: SID, r2Key: 'lesson_plans/t/s_lesson_plan.jpg', fileType: 'jpg', userId: 'teacher-1' };

  test('the pick that landed while the photo was being read stays linked', async () => {
    const { Worker, notify } = load({
      lesson_plan_link_method: 'selected_recent', has_lesson_plan: true,
      lesson_plan_structured: { _fidelity_ref: { lesson_id: LESSON, version_stamp: 'v1', content_hash: 'h1' } },
    });
    await Worker.process(job);
    const sessionWrites = updates.filter((u) => u.table === 'coaching_sessions').map((u) => u.payload);
    expect(sessionWrites.some((p) => p.has_lesson_plan === false)).toBe(false);
    expect(sessionWrites.some((p) => 'lesson_plan_structured' in p)).toBe(false);
    expect(sessionWrites.some((p) => p.lesson_plan_extraction_status === 'not_lesson_plan')).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  test('without a confirmed pick the verdict still clears the upload and says so (unchanged)', async () => {
    const { Worker, notify } = load({ lesson_plan_link_method: 'uploaded', has_lesson_plan: true, lesson_plan_structured: null });
    await Worker.process(job);
    const cleared = updates.find((u) => u.payload.lesson_plan_extraction_status === 'not_lesson_plan');
    expect(cleared.payload).toMatchObject({ has_lesson_plan: false, lesson_plan_structured: null });
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe('plan step: after a confirmed pick, a photo is a classroom photo (cause 2)', () => {
  let handleLessonPlanResponse; let holdPhotoForSession; let session;

  function load() {
    jest.resetModules();
    handleLessonPlanResponse = jest.fn(async () => {});
    holdPhotoForSession = jest.fn(async () => 1);
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
    jest.doMock('../../bot/shared/utils/logger', silentLogger);
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({ setNX: async () => true }));
    jest.doMock('../../bot/shared/services/coaching/media-target.service', () => ({
      getTarget: async () => null, clearTarget: async () => {}, setTarget: async () => {},
    }));
    jest.doMock('../../bot/shared/services/coaching/media-session-resolver', () => ({
      resolveMediaSession: async () => ({ outcome: 'single', session, candidates: [session] }),
      sessionAccepts: () => true, fetchSession: async () => session, isSenderParty: () => true,
    }));
    jest.doMock('../../bot/shared/services/coaching-orchestrator.service', () => ({ handleLessonPlanResponse }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({ downloadMedia: async () => Buffer.from('JPEG') }));
    jest.doMock('../../bot/shared/services/coaching/classroom-photo/capture.service', () => ({
      holdPhotoForSession, capturePhotoAndPrompt: jest.fn(async () => {}),
    }));
    return require('../../bot/shared/services/coaching/media-attach.service');
  }
  afterEach(() => {
    ['../../bot/shared/config/supabase', '../../bot/shared/utils/logger', '../../bot/shared/services/cache/railway-redis.service',
      '../../bot/shared/services/coaching/media-target.service', '../../bot/shared/services/coaching/media-session-resolver',
      '../../bot/shared/services/coaching-orchestrator.service', '../../bot/shared/services/whatsapp.service',
      '../../bot/shared/services/coaching/classroom-photo/capture.service'].forEach((m) => jest.dontMock(m));
    jest.resetModules();
  });

  const COACH = { id: 'coach-1', preferred_language: 'en' };
  const atPlanStep = (linkMethod) => ({
    id: SID, status: 'awaiting_lesson_plan', user_id: 'teacher-1', observer_user_id: COACH.id,
    observation_type: 'leader_observation', conversation_state: {}, classroom_photos: [], lesson_plan_link_method: linkMethod,
  });

  test('a photo sent as a document is held as a classroom photo, not read as a plan', async () => {
    session = atPlanStep('selected_recent');
    const Attach = load();
    expect(await Attach.handleLessonPlanMediaArrival({ user: COACH, from: FROM, mediaId: 'doc-1', mimeType: 'image/jpeg' })).toBe(true);
    expect(handleLessonPlanResponse).not.toHaveBeenCalled();
    expect(holdPhotoForSession).toHaveBeenCalledTimes(1);
    expect(holdPhotoForSession.mock.calls[0][0].session.id).toBe(SID);
  });

  test('a PDF after the pick still goes to the plan reader (unchanged)', async () => {
    session = atPlanStep('selected_recent');
    const Attach = load();
    await Attach.handleLessonPlanMediaArrival({ user: COACH, from: FROM, mediaId: 'doc-2', mimeType: 'application/pdf' });
    expect(handleLessonPlanResponse).toHaveBeenCalledWith(SID, FROM, true, 'doc-2');
    expect(holdPhotoForSession).not.toHaveBeenCalled();
  });

  test('a photo with no pick is still read as a plan (bd-2221, unchanged)', async () => {
    session = atPlanStep(null);
    const Attach = load();
    await Attach.handleLessonPlanMediaArrival({ user: COACH, from: FROM, mediaId: 'img-3', mimeType: 'image/jpeg' });
    expect(handleLessonPlanResponse).toHaveBeenCalledWith(SID, FROM, true, 'img-3');
    expect(holdPhotoForSession).not.toHaveBeenCalled();
  });
});

describe('the media resolver reads the link method it needs', () => {
  test('SESSION_COLUMNS carries lesson_plan_link_method', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../../bot/shared/services/coaching/media-session-resolver.js'), 'utf8');
    const line = src.split('\n').find((l) => /^const SESSION_COLUMNS = /.test(l));
    expect(line).toBeTruthy();
    expect(line).toMatch(/lesson_plan_link_method/);
  });
});
