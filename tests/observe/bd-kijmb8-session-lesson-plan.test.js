'use strict';
/**
 * bd-kijmb8 (queue #318) — open the lesson plan from a recording.
 *
 * One definition of "what plan is linked to this session and can the page open it", used by the bot's observation view
 * and the portal's session detail; and the file route that serves it with the same access rule as the page:
 * the teacher who owns the session, or the coach / principal who observed it. Library plans are served at the version she
 * taught from (`_fidelity_ref`), falling back to the current asset only when that version is gone.
 */
const { planRef, contentTypeOf } = require('../../bot/shared/services/coaching/session-lesson-plan');
const { createLessonPlanFileHandler, OPEN_KEY } = require('../../dashboard/lib/session-lesson-plan-route');

const TEACHER = 'aaaa0000-0000-4000-8000-000000000001';
const COACH = 'bbbb0000-0000-4000-8000-000000000002';
const OTHER = 'cccc0000-0000-4000-8000-000000000003';
const REF = { lesson_id: 'g4_sci_ch2_seg1', version_stamp: 'v8-20260816T1650', content_hash: 'abc123abc123' };

describe('planRef', () => {
  test('a library link is openable and says so', () => {
    const r = planRef({ has_lesson_plan: true, lesson_plan_structured: { _fidelity_ref: REF } });
    expect(r).toMatchObject({ source: 'library', openable: true, fileKind: 'pdf' });
  });
  test("her own photo, pdf and word file", () => {
    const base = { has_lesson_plan: true };
    expect(planRef({ ...base, lesson_plan_r2_key: 'lesson_plans/u1/portal_x.jpg', lesson_plan_format: 'jpg' }))
      .toMatchObject({ source: 'own', fileKind: 'image', openable: true });
    expect(planRef({ ...base, lesson_plan_r2_key: 'lesson_plans/u1/portal_x.pdf', lesson_plan_format: 'pdf' }))
      .toMatchObject({ source: 'own', fileKind: 'pdf', openable: true });
    expect(planRef({ ...base, lesson_plan_r2_key: 'lesson_plans/u1/portal_x.docx', lesson_plan_format: 'docx' }))
      .toMatchObject({ source: 'own', fileKind: 'word', openable: true });
  });
  test('no plan linked: not openable, nothing to show', () => {
    expect(planRef({})).toMatchObject({ source: 'none', openable: false });
    expect(planRef(null)).toMatchObject({ source: 'none', openable: false });
    expect(planRef({ has_lesson_plan: true })).toMatchObject({ openable: false });
  });
  test('a library ref wins over a re-saved pdf of the same lesson', () => {
    const r = planRef({ has_lesson_plan: true, lesson_plan_structured: { _fidelity_ref: REF }, lesson_plan_r2_key: 'lesson_plans/u1/s_lesson_plan.pdf', lesson_plan_format: 'pdf' });
    expect(r.source).toBe('library');
  });
  test('the title is the topic she wrote, when there is one', () => {
    expect(planRef({ has_lesson_plan: true, lesson_plan_structured: { _fidelity_ref: REF, topic: 'Plants' } }).title).toBe('Plants');
    expect(planRef({ has_lesson_plan: true, lesson_plan_structured: { _fidelity_ref: REF } }).title).toBeNull();
  });
  test('content types', () => {
    expect(contentTypeOf('pdf')).toBe('application/pdf');
    expect(contentTypeOf('image', 'x.png')).toBe('image/png');
    expect(contentTypeOf('image', 'x.jpg')).toBe('image/jpeg');
    expect(contentTypeOf('word', 'x.docx')).toMatch(/wordprocessingml/);
  });
});

function makeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

function setup({ session, flag = true, assets = [], urls = {} } = {}) {
  const calls = { relayed: [], logs: [] };
  const supabase = {
    from(table) {
      const q = { table, filters: {} };
      const self = {
        select: () => self,
        eq: (c, v) => { q.filters[c] = v; return self; },
        order: () => self, limit: () => self,
        maybeSingle: async () => {
          if (table === 'coaching_sessions') return { data: session && session.id === q.filters.id ? session : null };
          return { data: null };
        },
        then: (ok) => {
          if (table === 'niete_lp_assets') {
            const rows = assets.filter((a) => Object.entries(q.filters).every(([k, v]) => a[k] === v));
            return Promise.resolve({ data: rows }).then(ok);
          }
          return Promise.resolve({ data: [] }).then(ok);
        },
      };
      return self;
    },
  };
  const handler = createLessonPlanFileHandler({
    supabase,
    isOn: async () => flag,
    resolveUrl: async (key) => urls[key] || `https://signed.example/${key}`,
    relay: async (url, res, opts) => { calls.relayed.push({ url, ...opts }); res.status(200); },
    log: (...a) => calls.logs.push(a),
  });
  return { handler, calls };
}
const req = (id, userId, query = {}) => ({ params: { id }, query, session: { portalUserId: userId } });

const OWN = { id: 's1', user_id: TEACHER, has_lesson_plan: true, lesson_plan_r2_key: 'lesson_plans/u1/portal_x.jpg', lesson_plan_format: 'jpg', observation_type: null };
const OBS = { id: 's2', user_id: TEACHER, observer_user_id: COACH, observation_type: 'leader_observation', has_lesson_plan: true,
  lesson_plan_structured: { _fidelity_ref: REF }, analysis_data: { teacher_delivery: { status: 'sent' } } };

describe('GET /coaching-session/:id/lesson-plan/file', () => {
  test('the switch is off: 404, nothing read', async () => {
    const { handler, calls } = setup({ session: OWN, flag: false });
    const res = makeRes();
    await handler(req('s1', TEACHER), res);
    expect(res.statusCode).toBe(404);
    expect(calls.relayed).toHaveLength(0);
  });
  test('the owner gets her photo, as an image', async () => {
    const { handler, calls } = setup({ session: OWN });
    const res = makeRes();
    await handler(req('s1', TEACHER), res);
    expect(res.statusCode).toBe(200);
    expect(calls.relayed[0]).toMatchObject({ url: 'https://signed.example/lesson_plans/u1/portal_x.jpg', contentType: 'image/jpeg' });
  });
  test("someone else's session is a 404, the same as one that does not exist", async () => {
    const { handler, calls } = setup({ session: OWN });
    const res = makeRes();
    await handler(req('s1', OTHER), res);
    expect(res.statusCode).toBe(404);
    expect(calls.relayed).toHaveLength(0);
  });
  test('the coach who observed it can read the plan; another coach cannot', async () => {
    const a = setup({ session: OBS, assets: [{ lesson_id: REF.lesson_id, version_stamp: REF.version_stamp, asset_kind: 'lesson', r2_key: 'lp-cache/v8/x/old.pdf', is_current: false }] });
    const ok = makeRes();
    await a.handler(req('s2', COACH), ok);
    expect(ok.statusCode).toBe(200);
    const no = makeRes();
    await a.handler(req('s2', OTHER), no);
    expect(no.statusCode).toBe(404);
  });
  test('a coach observation not yet sent to the teacher is not hers to read', async () => {
    const draft = { ...OBS, analysis_data: { teacher_delivery: { status: 'awaiting_confirm' } } };
    const { handler } = setup({ session: draft });
    const res = makeRes();
    await handler(req('s2', TEACHER), res);
    expect(res.statusCode).toBe(404);
  });
  test('a library link serves the version she taught from, not the newest', async () => {
    const assets = [
      { lesson_id: REF.lesson_id, version_stamp: REF.version_stamp, asset_kind: 'lesson', r2_key: 'lp-cache/v8/g4/OLD.pdf', is_current: false },
      { lesson_id: REF.lesson_id, version_stamp: 'v8-20261101T0900', asset_kind: 'lesson', r2_key: 'lp-cache/v8/g4/NEW.pdf', is_current: true },
    ];
    const { handler, calls } = setup({ session: OBS, assets });
    await handler(req('s2', COACH), makeRes());
    expect(calls.relayed[0].url).toContain('OLD.pdf');
    expect(calls.relayed[0].contentType).toBe('application/pdf');
  });
  test('if that version is gone, the current asset', async () => {
    const assets = [{ lesson_id: REF.lesson_id, version_stamp: 'v8-20261101T0900', asset_kind: 'lesson', r2_key: 'lp-cache/v8/g4/NEW.pdf', is_current: true }];
    const { handler, calls } = setup({ session: OBS, assets });
    await handler(req('s2', COACH), makeRes());
    expect(calls.relayed[0].url).toContain('NEW.pdf');
  });
  test('a library lesson with no asset at all is "not ready" (404 available:false)', async () => {
    const { handler } = setup({ session: OBS, assets: [] });
    const res = makeRes();
    await handler(req('s2', COACH), res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ available: false });
  });
  test('a session with no plan: 404', async () => {
    const { handler } = setup({ session: { id: 's3', user_id: TEACHER } });
    const res = makeRes();
    await handler(req('s3', TEACHER), res);
    expect(res.statusCode).toBe(404);
  });
  test('?link=1 answers the signed link as json (for "open in another app")', async () => {
    const { handler, calls } = setup({ session: OWN });
    const res = makeRes();
    await handler(req('s1', TEACHER, { link: '1' }), res);
    expect(res.body).toMatchObject({ success: true, available: true, url: expect.stringContaining('portal_x.jpg') });
    expect(calls.relayed).toHaveLength(0);
  });
  test('logs ids only, never a url or key', async () => {
    const { handler, calls } = setup({ session: OWN });
    await handler(req('s1', TEACHER), makeRes());
    const text = JSON.stringify(calls.logs);
    expect(text).not.toMatch(/signed\.example|lesson_plans\//);
  });
  test('the switch key', () => expect(OPEN_KEY).toBe('portal_lesson_plan_open'));
});
