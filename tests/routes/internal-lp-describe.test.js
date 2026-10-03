/**
 * bd-5rz1v.15 — the bot names the lesson plans the portal lists.
 *
 * The portal's "recent lesson plans" and the Home's "Lesson plans used" list come from activity
 * rows that hold only a plan key: a K-5 catalogue lesson_id or a 6-12 segment_id. The portal holds
 * no catalogue (it once read a different corpus from WhatsApp's), so it asks the bot what
 * each plan IS — the same catalogue JSON and the same niete_lp612_segments rows WhatsApp names
 * them from.
 *
 *   POST /api/internal/lp/describe  { plans: [{ kind: 'k5'|'g612', ref, lang? }] }
 *     → { success, plans: [{ kind, ref, lang, found, title, grade, subject, chapterNumber,
 *                             chapterTitle, dayLabel, pagesLabel }] }   in the order asked
 *
 * And the 6-12 poll now says which LANGUAGE the ready document is in, so an open can be recorded
 * against (segment, lang) — a render id is not a stable plan id.
 */

let router;
let segmentRows;
let segmentQueries;
let renderRow;

function findRoute(r, method, path) {
  for (const layer of r.stack) {
    if (!layer.route) continue;
    if ((layer.route.methods || {})[method] && layer.route.path === path) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invoke(path, { headers = { 'x-api-key': KEY }, body = {} } = {}) {
  const stack = findRoute(router, 'post', path);
  if (!stack) throw new Error(`route POST ${path} not found`);
  const req = { headers, body, ip: '127.0.0.1', method: 'POST', path };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (!advanced) resolve();
    });
  }
  return { statusCode, payload };
}

const KEY = 'shared-secret-key';

beforeEach(() => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;
  segmentQueries = [];
  segmentRows = [{
    segment_id: 'grade_9_physics.c02.p010', grade: 9, subject: 'Physics', chapter_number: 2,
    chapter_title: 'Kinematics', subtopic_title: 'Speed and velocity', menu_title: 'Speed',
    printed_page_start: 10, printed_page_end: 12,
  }];
  renderRow = {
    id: 'R1', segment_id: 'grade_9_physics.c02.p010', status: 'ready', r2_key: 'lp612/v9.2/ur/x.pdf',
    one_screen: null, error_code: null, lang: 'ur', started_at: null, completed_at: null,
    requested_by: 'teacher-1', waiters: [],
  };
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../bot/shared/storage/r2', () => ({
    buildR2PublicUrl: (k) => `https://r2.example/${k}`,
    getPresignedUrl: async (u) => `${u}?sig=1`,
  }));
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: jest.fn((table) => {
      const f = {};
      const chain = {
        select: () => chain,
        eq: (c, v) => { f[c] = v; return chain; },
        gte: () => chain,
        lte: () => chain,
        in: (c, v) => { f[c] = v; segmentQueries.push({ table, column: c, values: v }); return chain; },
        maybeSingle: async () => ({ data: table === 'niete_lp612_renders' && f.id === renderRow.id ? renderRow : null, error: null }),
        then: (resolve, reject) => Promise.resolve({
          data: table === 'niete_lp612_segments'
            ? segmentRows.filter((r) => (f.segment_id || []).includes(r.segment_id))
            : [],
          error: null,
        }).then(resolve, reject),
      };
      return chain;
    }),
  }));
  router = require('../../bot/shared/routes/internal-api.routes');
});

afterEach(() => {
  delete process.env.INTERNAL_API_KEY;
  jest.resetModules();
});

describe('POST /api/internal/lp/describe', () => {
  test('is behind the shared key', async () => {
    const { statusCode } = await invoke('/lp/describe', { headers: {}, body: { plans: [] } });
    expect(statusCode).toBe(401);
  });

  test('names a grades 1-5 plan from the catalogue the WhatsApp Flow uses', async () => {
    const { statusCode, payload } = await invoke('/lp/describe', {
      body: { plans: [{ kind: 'k5', ref: 'grade_1_english_ch1_seg1' }] },
    });
    expect(statusCode).toBe(200);
    expect(payload.plans).toEqual([expect.objectContaining({
      kind: 'k5', ref: 'grade_1_english_ch1_seg1', lang: null, found: true,
      title: 'All About Me: Key Words', grade: 1, subject: 'English',
      chapterNumber: 1, chapterTitle: 'Hello World!', dayLabel: 'Day 1', pagesLabel: 'p.2',
    })]);
  });

  test('names grades 6-12 plans in ONE read of the segments, whatever the count', async () => {
    const { payload } = await invoke('/lp/describe', {
      body: { plans: [
        { kind: 'g612', ref: 'grade_9_physics.c02.p010', lang: 'ur' },
        { kind: 'g612', ref: 'grade_9_physics.c02.p010', lang: 'en' },
      ] },
    });
    expect(segmentQueries).toHaveLength(1);
    expect(segmentQueries[0]).toMatchObject({ table: 'niete_lp612_segments', column: 'segment_id' });
    expect(payload.plans[0]).toMatchObject({
      kind: 'g612', ref: 'grade_9_physics.c02.p010', lang: 'ur', found: true,
      title: 'Speed and velocity', grade: 9, subject: 'Physics', chapterNumber: 2,
      chapterTitle: 'Kinematics', pagesLabel: 'p.10-12',
    });
    expect(payload.plans[1]).toMatchObject({ lang: 'en', found: true });
  });

  test('an unknown plan is answered, not dropped — the caller keeps its place in the list', async () => {
    const { payload } = await invoke('/lp/describe', {
      body: { plans: [
        { kind: 'k5', ref: 'grade_9_nothing_ch1_seg1' },
        { kind: 'g612', ref: 'gone.c01.p001', lang: 'en' },
        { kind: 'k5', ref: 'grade_1_english_ch1_seg1' },
      ] },
    });
    expect(payload.plans.map((p) => [p.ref, p.found])).toEqual([
      ['grade_9_nothing_ch1_seg1', false], ['gone.c01.p001', false], ['grade_1_english_ch1_seg1', true],
    ]);
  });

  test.each([
    ['no list', {}],
    ['not a list', { plans: 'k5:x' }],
    ['an unknown kind', { plans: [{ kind: 'k12', ref: 'x' }] }],
    ['no ref', { plans: [{ kind: 'k5' }] }],
    ['too many at once', { plans: Array.from({ length: 201 }, (_, i) => ({ kind: 'k5', ref: `x${i}` })) }],
  ])('refuses %s with a 400', async (_label, body) => {
    const { statusCode } = await invoke('/lp/describe', { body });
    expect(statusCode).toBe(400);
  });
});

describe('POST /api/internal/lp612/status — the ready answer names its language', () => {
  test('a ready render carries segmentId AND lang', async () => {
    const { payload } = await invoke('/lp612/status', { body: { renderId: 'R1', userId: 'teacher-1' } });
    expect(payload).toMatchObject({ success: true, state: 'ready', segmentId: 'grade_9_physics.c02.p010', lang: 'ur' });
  });
});
