/**
 * bd-fmf24g.15 — teacher app v2: what she asked for and where it has got to, kept on the server so the
 * shell (the strip, the banner) and Home ("Ready for you") survive a refresh or a new device.
 *
 *   GET  /api/portal/me/notices                  → { items: [...] } her papers and grades 6-12 lesson plans
 *   POST /api/portal/me/notices/:id/seen         she closed the banner (the X, or went to Home from it)
 *   POST /api/portal/me/notices/:id/opened       she opened it (or tapped a failed one)
 *
 * What the tests hold it to:
 *   - the teacher is ALWAYS the session's user; an id that is not hers is "not found", never an error that
 *     says it exists;
 *   - PAPERS come from her portal requests (assessment_requests, surface portal) and the latest attempt:
 *     making / ready / failed; LESSON PLANS from the 6-12 renders she is waiting on and her portal
 *     deliveries (the ones she WAITED for, not a cache hit she opened at once);
 *   - what is returned is only what the app still needs: a thing being made for under 30 minutes, a ready
 *     one that she has not opened and that is inside its 24 weekday hours (stamped `homeUntil`), a failed
 *     paper she has not tapped, from the last day;
 *   - a lesson plan she opened ANY way (a viewer, WhatsApp's link, Recent) is opened: the existing
 *     niete_lp_opens rows say so, no second record;
 *   - seen / opened are written once and never rewritten (COALESCE), one conditional UPDATE each;
 *   - nothing here sends a WhatsApp message.
 */

const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const REQ = '11111111-1111-4111-8111-111111111111';
const REQ2 = '22222222-2222-4222-8222-222222222222';
const PAPER = '33333333-3333-4333-8333-333333333333';
const RENDER = '44444444-4444-4444-8444-444444444444';
const RENDER2 = '55555555-5555-4555-8555-555555555555';

// Thursday 2026-10-08, 12:00 in Pakistan.
const NOW = new Date('2026-10-08T07:00:00Z');
const ago = (min) => new Date(NOW.getTime() - min * 60_000).toISOString();

const N = () => require('../../dashboard/services/teacher-notices.service');

function rows({ papers = [], ready = [], pending = [] } = {}) {
  return jest.fn(async (sql) => {
    if (/FROM assessment_requests/.test(sql) && /^\s*SELECT/i.test(sql)) return { rows: papers };
    if (/FROM niete_lp612_deliveries/.test(sql) && /^\s*(WITH|SELECT)/i.test(sql)) return { rows: ready };
    if (/FROM niete_lp612_renders/.test(sql) && /^\s*SELECT/i.test(sql)) return { rows: pending };
    return { rows: [] };
  });
}

const paperRow = (over = {}) => ({
  request_id: REQ, grade_code: 'grade_4', subject_code: 'science', chapter_number: 2, requested_questions: 15,
  created_at: ago(5), notice_seen_at: null, notice_opened_at: null,
  paper_id: null, paper_status: null, error_code: null, ready_at: null, paper_questions: null, ...over,
});
const lessonReady = (over = {}) => ({
  render_id: RENDER, segment_id: 'phy9.c02.p010', lang: 'en', delivered_at: ago(3),
  notice_seen_at: null, notice_opened_at: null, opened_in_app: null,
  subtopic_title: 'Speed', menu_title: 'Speed and velocity', grade: 9, subject: 'Physics', ...over,
});
const lessonPending = (over = {}) => ({
  id: RENDER2, segment_id: 'bio7.c01.p001', lang: 'en', started_at: ago(1),
  subtopic_title: 'Cells', menu_title: 'Cells', grade: 7, subject: 'Science', ...over,
});

beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('listNotices: her papers', () => {
  it('a request with no paper yet, or one still queued or generating, is being made', async () => {
    const query = rows({ papers: [
      paperRow({ request_id: REQ }),
      paperRow({ request_id: REQ2, paper_status: 'generating', created_at: ago(2) }),
    ] });
    const { items } = await N().listNotices(query, TEACHER, { now: NOW });
    // newest first
    expect(items.map((i) => [i.id, i.state])).toEqual([[`paper:${REQ2}`, 'making'], [`paper:${REQ}`, 'making']]);
    expect(items[1]).toMatchObject({
      kind: 'paper', grade: 4, subject: 'Science', subjectKey: 'science', chapterNumber: 2, questions: 15, paperId: null,
      startedAt: ago(5),
    });
  });

  it('a ready paper carries its paper id, when it was ready, and when Home lets go of it', async () => {
    const query = rows({ papers: [paperRow({ paper_id: PAPER, paper_status: 'ready', ready_at: ago(10), paper_questions: 14 })] });
    const { items } = await N().listNotices(query, TEACHER, { now: NOW });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      state: 'ready', paperId: PAPER, readyAt: ago(10), questions: 14, seenAt: null, openedAt: null,
      // Thursday 11:50 + 24 weekday hours = Friday 11:50 (Pakistan)
      homeUntil: '2026-10-09T06:50:00.000Z',
    });
  });

  it('a paper she has opened is no longer news', async () => {
    const query = rows({ papers: [paperRow({ paper_id: PAPER, paper_status: 'ready', ready_at: ago(10), notice_opened_at: ago(2), notice_seen_at: ago(3) })] });
    expect((await N().listNotices(query, TEACHER, { now: NOW })).items).toEqual([]);
  });

  it('seen but not opened stays (Home keeps it), and says it was seen', async () => {
    const query = rows({ papers: [paperRow({ paper_id: PAPER, paper_status: 'ready', ready_at: ago(40), notice_seen_at: ago(39) })] });
    const { items } = await N().listNotices(query, TEACHER, { now: NOW });
    expect(items[0]).toMatchObject({ state: 'ready', seenAt: ago(39), openedAt: null });
  });

  it('a ready paper past its 24 weekday hours is gone; the weekend does not count', async () => {
    const stale = rows({ papers: [paperRow({ paper_id: PAPER, paper_status: 'ready', ready_at: '2026-10-07T04:00:00Z' })] });
    expect((await N().listNotices(stale, TEACHER, { now: NOW })).items).toEqual([]);
    // Friday 22:00 PKT, asked about on Monday 21:00 PKT: 2 + 21 = 23 weekday hours — still there.
    const friday = rows({ papers: [paperRow({ paper_id: PAPER, paper_status: 'ready', ready_at: '2026-10-09T17:00:00Z' })] });
    const monday = new Date('2026-10-12T16:00:00Z');
    expect((await N().listNotices(friday, TEACHER, { now: monday })).items).toHaveLength(1);
  });

  it('a paper still being made after 30 minutes is not listed (the worker lost it; the page can still ask)', async () => {
    const query = rows({ papers: [paperRow({ created_at: ago(45), paper_status: 'generating' })] });
    expect((await N().listNotices(query, TEACHER, { now: NOW })).items).toEqual([]);
  });

  it('a failed paper carries its error code until she taps it, for a day', async () => {
    const failed = rows({ papers: [paperRow({ paper_status: 'failed', error_code: 'TRUNCATED', created_at: ago(120) })] });
    const { items } = await N().listNotices(failed, TEACHER, { now: NOW });
    expect(items[0]).toMatchObject({ state: 'failed', errorCode: 'TRUNCATED' });
    const tapped = rows({ papers: [paperRow({ paper_status: 'failed', error_code: 'TRUNCATED', created_at: ago(120), notice_opened_at: ago(60) })] });
    expect((await N().listNotices(tapped, TEACHER, { now: NOW })).items).toEqual([]);
    const old = rows({ papers: [paperRow({ paper_status: 'failed', error_code: 'TRUNCATED', created_at: ago(26 * 60) })] });
    expect((await N().listNotices(old, TEACHER, { now: NOW })).items).toEqual([]);
  });

  it('asks only for HER portal requests, in the last days, from the session user', async () => {
    const query = rows();
    await N().listNotices(query, TEACHER, { now: NOW });
    const [sql, params] = query.mock.calls.find(([s]) => /FROM assessment_requests/.test(s));
    expect(sql).toMatch(/user_id = \$1::uuid/);
    expect(sql).toMatch(/surface = 'portal'/);
    expect(params[0]).toBe(TEACHER);
  });
});

describe('listNotices: her lesson plans (grades 6-12)', () => {
  it('a render she is waiting on is being made', async () => {
    const { items } = await N().listNotices(rows({ pending: [lessonPending()] }), TEACHER, { now: NOW });
    expect(items).toEqual([expect.objectContaining({
      id: `lesson:${RENDER2}`, kind: 'lesson', state: 'making', title: 'Cells', grade: 7, subject: 'Science',
      lessonId: 'bio7.c01.p001', renderId: RENDER2, lang: 'en', startedAt: ago(1),
    })]);
  });

  it('a lesson she waited for is ready, with its title and when Home lets go', async () => {
    const { items } = await N().listNotices(rows({ ready: [lessonReady()] }), TEACHER, { now: NOW });
    expect(items).toEqual([expect.objectContaining({
      id: `lesson:${RENDER}`, state: 'ready', title: 'Speed', grade: 9, subject: 'Physics', renderId: RENDER,
      readyAt: ago(3), homeUntil: '2026-10-09T06:57:00.000Z',
    })]);
  });

  it('opened in the app by ANY way (a niete_lp_opens row since it was ready) counts as opened', async () => {
    const via = rows({ ready: [lessonReady({ opened_in_app: ago(1) })] });
    expect((await N().listNotices(via, TEACHER, { now: NOW })).items).toEqual([]);
    const banner = rows({ ready: [lessonReady({ notice_opened_at: ago(1) })] });
    expect((await N().listNotices(banner, TEACHER, { now: NOW })).items).toEqual([]);
  });

  it('the ready lessons are the ones she WAITED for: a render ready long before she asked is not "made for you"', async () => {
    const query = rows();
    await N().listNotices(query, TEACHER, { now: NOW });
    const [sql] = query.mock.calls.find(([s]) => /FROM niete_lp612_deliveries/.test(s));
    expect(sql).toMatch(/surface = 'portal'/);
    expect(sql).toMatch(/completed_at/);
    expect(sql).toMatch(/niete_lp_opens/);
  });

  it('a lesson still authoring is looked up by her waiter entry or as requester, young ones only', async () => {
    const query = rows();
    await N().listNotices(query, TEACHER, { now: NOW });
    const [sql, params] = query.mock.calls.find(([s]) => /FROM niete_lp612_renders/.test(s) && !/niete_lp612_deliveries/.test(s));
    expect(sql).toMatch(/waiters @>/);
    expect(sql).toMatch(/requested_by = \$1::uuid/);
    expect(sql).toMatch(/status = 'authoring'/);
    expect(params[0]).toBe(TEACHER);
  });

  it('papers and plans come back together, newest first', async () => {
    const query = rows({ papers: [paperRow({ created_at: ago(5) })], pending: [lessonPending({ started_at: ago(1) })] });
    const { items } = await N().listNotices(query, TEACHER, { now: NOW });
    expect(items.map((i) => i.kind)).toEqual(['lesson', 'paper']);
  });
});

describe('failure is not silent', () => {
  it('a database error is thrown for the route to answer 502 — never an empty list that says "nothing for you"', async () => {
    const query = jest.fn(async () => { throw new Error('connection reset'); });
    await expect(N().listNotices(query, TEACHER, { now: NOW })).rejects.toThrow('connection reset');
  });
});

describe('parseId', () => {
  it('paper:<uuid> and lesson:<uuid> only', () => {
    expect(N().parseId(`paper:${REQ}`)).toEqual({ kind: 'paper', ref: REQ });
    expect(N().parseId(`lesson:${RENDER}`)).toEqual({ kind: 'lesson', ref: RENDER });
    for (const bad of ['', 'paper:', 'paper:nope', `thing:${REQ}`, `paper:${REQ}; DROP TABLE users`, null, undefined, 7]) {
      expect(N().parseId(bad)).toBeNull();
    }
  });
});

describe('markSeen / markOpened', () => {
  const update = (found = true) => jest.fn(async () => ({ rows: found ? [{ id: REQ }] : [] }));

  it('seen on a paper: one conditional UPDATE on HER portal request, never rewriting an earlier time', async () => {
    const query = update();
    expect(await N().markSeen(query, TEACHER, `paper:${REQ}`)).toEqual({ ok: true });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE assessment_requests/);
    expect(sql).toMatch(/notice_seen_at = COALESCE\(notice_seen_at, now\(\)\)/);
    expect(sql).toMatch(/user_id = \$2::uuid/);
    expect(sql).toMatch(/surface = 'portal'/);
    expect(sql).not.toMatch(/notice_opened_at/);
    expect(params).toEqual([REQ, TEACHER]);
  });

  it('opened on a paper also means seen', async () => {
    const query = update();
    await N().markOpened(query, TEACHER, `paper:${REQ}`);
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/notice_opened_at = COALESCE\(notice_opened_at, now\(\)\)/);
    expect(sql).toMatch(/notice_seen_at = COALESCE\(notice_seen_at, now\(\)\)/);
  });

  it('on a lesson plan it is her portal delivery row(s) of that render', async () => {
    const query = update();
    await N().markOpened(query, TEACHER, `lesson:${RENDER}`);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE niete_lp612_deliveries/);
    expect(sql).toMatch(/render_id = \$1::uuid/);
    expect(sql).toMatch(/user_id = \$2::uuid/);
    expect(sql).toMatch(/surface = 'portal'/);
    expect(params).toEqual([RENDER, TEACHER]);
  });

  it('an id that is not hers (or is not there) is NOT_FOUND, and says nothing more', async () => {
    expect(await N().markSeen(update(false), TEACHER, `paper:${REQ}`)).toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('a malformed id is BAD_ID and the database is not asked', async () => {
    const query = update();
    expect(await N().markOpened(query, TEACHER, 'paper:nope')).toEqual({ ok: false, code: 'BAD_ID' });
    expect(query).not.toHaveBeenCalled();
  });

  it('a user id that is not a uuid is refused before the database', async () => {
    const query = update();
    await expect(N().markSeen(query, 'not-a-uuid', `paper:${REQ}`)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('this module sends nothing to WhatsApp', () => {
  it('no WhatsApp, template or message service is required by it', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../dashboard/services/teacher-notices.service.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/whatsapp\.service|sendTemplate|sendMessage|sendDocument/i);
  });
});
