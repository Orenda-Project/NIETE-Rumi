/**
 * bd-fmf24g.15 — the WhatsApp fallback for a finished paper or grades 6-12 lesson plan she did not see.
 * BUILT SWITCHED OFF: app_settings `portal_ready_whatsapp_enabled` (absent = off) and an allow-list
 * `portal_ready_whatsapp_teachers` ("all" or her id). Nothing here is submitted to Meta or sent to a real number:
 * WhatsApp (sendTemplate) is the network boundary and is mocked; the sweep's own query-building, claiming and
 * message-building run for real, against an in-memory stand-in for PostgREST.
 *
 * The operator's rules (2026-10-09), each held below:
 *   - decided SERVER-side (the app may be closed), by a sweep: an item that became ready at least ~30 s ago
 *     (10 s banner + the polling gap) and is neither seen (she closed the banner with its X) nor opened;
 *   - at most ONE message per item, ever: a conditional UPDATE claims it before the send; a refused send is
 *     logged at ERROR and not retried (a missed message beats a duplicate);
 *   - a FAILURE is never sent to WhatsApp (nothing is made, so nothing to send);
 *   - a UTILITY template with the PDF in a document header and an "Open in app" URL button — never free text;
 *   - the lesson plans are the ones she WAITED for, not a cache hit she opened at once;
 *   - bounded per tick, never throws, one log line per tick that did something.
 */

const { createFakePostgrest } = require('./helpers/fake-postgrest');

const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const OTHER = '7a2d3b8f-1c9e-4d66-8b62-3e8a1f4c0d21';
const REQ = '11111111-1111-4111-8111-111111111111';
const PAPER = '33333333-3333-4333-8333-333333333333';
const RENDER = '44444444-4444-4444-8444-444444444444';

// Thursday 2026-10-08 07:00:00Z.
const NOW = Date.UTC(2026, 9, 8, 7, 0, 0);
const iso = (secAgo) => new Date(NOW - secAgo * 1000).toISOString();

const relations = {
  assessment_requests: { assessment_papers: { table: 'assessment_papers', parentKey: 'id', childKey: 'request_id' } },
  niete_lp612_deliveries: { niete_lp612_renders: { table: 'niete_lp612_renders', parentKey: 'render_id', childKey: 'id', one: true } },
};

const request = (over = {}) => ({
  id: REQ, user_id: TEACHER, surface: 'portal', grade_code: 'grade_4', subject_code: 'science', chapter_number: 2, question_count: 15,
  created_at: iso(120), notice_seen_at: null, notice_opened_at: null, notice_whatsapp_at: null, ...over,
});
const paper = (over = {}) => ({
  id: PAPER, request_id: REQ, status: 'ready', ready_at: iso(40), edited_from: null, attempt: 1, file_r2_key: 'papers/p1.pdf', question_count: 15, ...over,
});
const delivery = (over = {}) => ({
  id: 'd1', user_id: TEACHER, render_id: RENDER, segment_id: 'phy9.c02.p010', lang: 'en', surface: 'portal',
  delivered_at: iso(40), notice_seen_at: null, notice_opened_at: null, notice_whatsapp_at: null, ...over,
});
const render = (over = {}) => ({
  id: RENDER, status: 'ready', r2_key: 'lp612/r1.pdf', completed_at: iso(41), template_version: 'v9.3', ...over,
});

let fake; let whatsapp; let logs; let settings;

function boot({ tables = {}, on = true, teachers = 'all', users } = {}) {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = 'test-internal-key';
  settings = [];
  if (on !== null) settings.push({ key: 'portal_ready_whatsapp_enabled', value: on });
  if (teachers !== null) settings.push({ key: 'portal_ready_whatsapp_teachers', value: teachers });
  fake = createFakePostgrest({
    relations,
    tables: {
      app_settings: settings,
      users: users || [{ id: TEACHER, phone_number: '923001234567', preferred_language: 'en' }],
      niete_lp_opens: [],
      niete_lp612_segments: [{ segment_id: 'phy9.c02.p010', subtopic_title: 'Speed', menu_title: 'Speed and velocity', grade: 9, subject: 'Physics' }],
      assessment_requests: [], assessment_papers: [], niete_lp612_deliveries: [], niete_lp612_renders: [],
      ...tables,
    },
  });
  whatsapp = { sendTemplate: jest.fn(async () => true), sendMessage: jest.fn(async () => true), sendDocumentByLink: jest.fn(async () => true) };
  logs = [];
  jest.doMock('../../bot/shared/config/supabase', () => fake);
  jest.doMock('../../bot/shared/services/whatsapp.service', () => whatsapp);
  jest.doMock('../../bot/shared/storage/r2', () => ({
    buildR2PublicUrl: (k) => `https://r2.example/${k}`,
    getPresignedUrl: async (u) => `${u}?sig=1`,
  }));
  jest.doMock('../../bot/shared/services/assessment/assessment-browse.service', () => ({
    listChapters: async () => [{ chapter_number: 2, chapter_title: 'Plants and food' }],
  }));
  jest.doMock('../../bot/shared/utils/logger', () => ({
    logToFile: (message, data, level = 'info') => { logs.push({ message, data, level }); },
    logError: (message, data) => { logs.push({ message, data, level: 'error' }); },
    logWarn: (message, data) => { logs.push({ message, data, level: 'warn' }); },
  }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({ logEvent: (name, data) => { logs.push({ message: name, data, level: 'event' }); } }));
  return require('../../bot/shared/services/portal-ready-whatsapp.service');
}

const readyPaper = (over = {}) => ({
  assessment_requests: [request(over.request)], assessment_papers: [paper(over.paper)],
});
const readyLesson = (over = {}) => ({
  niete_lp612_deliveries: [delivery(over.delivery)], niete_lp612_renders: [render(over.render)],
});
const errors = () => logs.filter((l) => l.level === 'error');

describe('it is OFF until someone turns it on', () => {
  it('with no setting at all: nothing is read but the switch, and nothing is sent', async () => {
    const Ready = boot({ on: null, teachers: null, tables: readyPaper() });
    const out = await Ready.runSweep({ now: NOW });
    expect(out).toMatchObject({ enabled: false, sent: 0 });
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(fake.queries.map((q) => q.table)).toEqual(['app_settings']);
  });

  it('switched on but false, or a settings read that fails, is off too (fail closed)', async () => {
    let Ready = boot({ on: false, tables: readyPaper() });
    expect((await Ready.runSweep({ now: NOW })).enabled).toBe(false);
    Ready = boot({ on: true, tables: readyPaper() });
    fake.from = () => { throw new Error('db down'); };
    await expect(Ready.runSweep({ now: NOW })).resolves.toMatchObject({ enabled: false, sent: 0 });
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
  });

  it('on, but the teacher is not on the allow-list: skipped, not claimed, not sent', async () => {
    const Ready = boot({ teachers: [OTHER], tables: readyPaper() });
    const out = await Ready.runSweep({ now: NOW });
    expect(out).toMatchObject({ enabled: true, sent: 0, skipped: 1 });
    expect(fake.db.assessment_requests[0].notice_whatsapp_at).toBeNull();
  });

  it('"all", or her id in the list, lets her through', async () => {
    expect((await boot({ teachers: 'all', tables: readyPaper() }).runSweep({ now: NOW })).sent).toBe(1);
    expect((await boot({ teachers: [TEACHER], tables: readyPaper() }).runSweep({ now: NOW })).sent).toBe(1);
  });
});

describe('a paper that was not seen', () => {
  it('is sent once: the PDF in the header, its words in the body, an Open in app button — as a UTILITY template, never free text', async () => {
    const Ready = boot({ tables: readyPaper() });
    const out = await Ready.runSweep({ now: NOW });
    expect(out).toMatchObject({ enabled: true, candidates: 1, claimed: 1, sent: 1, failed: 0 });
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
    const [to, name, lang, components] = whatsapp.sendTemplate.mock.calls[0];
    expect([to, name, lang]).toEqual(['923001234567', 'paper_ready_v1', 'en']);
    const byType = Object.fromEntries(components.map((c) => [c.type, c]));
    expect(byType.header.parameters[0]).toEqual({
      type: 'document', document: { link: 'https://r2.example/papers/p1.pdf?sig=1', filename: 'Paper - Grade 4 Science - Plants and food.pdf' },
    });
    expect(byType.body.parameters.map((p) => p.text)).toEqual(['Plants and food', '4', 'Science', '15']);
    expect(byType.button).toMatchObject({ sub_type: 'url', index: '0' });
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
    expect(whatsapp.sendDocumentByLink).not.toHaveBeenCalled();
  });

  it('the button carries a signed link that lands on THIS paper for THIS teacher (24 h, the "ready" area)', async () => {
    const Ready = boot({ tables: readyPaper() });
    await Ready.runSweep({ now: NOW });
    const token = whatsapp.sendTemplate.mock.calls[0][3].find((c) => c.type === 'button').parameters[0].text;
    const { verifyPortalLink } = require('../../bot/shared/services/portal-link-token');
    expect(verifyPortalLink(token)).toMatchObject({ u: TEACHER, area: 'ready', i: `paper:${REQ}` });
  });

  it('is claimed BEFORE the send and never sent twice, however many sweeps run', async () => {
    const Ready = boot({ tables: readyPaper() });
    await Ready.runSweep({ now: NOW });
    expect(fake.db.assessment_requests[0].notice_whatsapp_at).not.toBeNull();
    await Ready.runSweep({ now: NOW + 60_000 });
    await Ready.runSweep({ now: NOW + 120_000 });
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
  });

  it('two sweeps at once (two replicas) still send one message: the claim is one conditional UPDATE', async () => {
    const Ready = boot({ tables: readyPaper() });
    const [a, b] = await Promise.all([Ready.runSweep({ now: NOW }), Ready.runSweep({ now: NOW })]);
    expect(a.sent + b.sent).toBe(1);
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
    const claim = fake.queries.find((q) => q.op === 'update');
    expect(claim.filters.map((f) => `${f.kind}:${f.col}`)).toEqual(expect.arrayContaining([
      'is:notice_whatsapp_at', 'is:notice_opened_at', 'is:notice_seen_at',
    ]));
  });

  it('is NOT sent when she closed the banner with its X (seen) or opened it, or it was already sent', async () => {
    for (const over of [{ notice_seen_at: iso(20) }, { notice_opened_at: iso(20) }, { notice_whatsapp_at: iso(20) }]) {
      const Ready = boot({ tables: readyPaper({ request: over }) });
      expect((await Ready.runSweep({ now: NOW })).sent).toBe(0);
    }
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
  });

  it('is NOT sent while the banner may still be on screen (ready under 30 seconds ago), and IS once it is not', async () => {
    const Ready = boot({ tables: readyPaper({ paper: { ready_at: iso(20) } }) });
    expect((await Ready.runSweep({ now: NOW })).sent).toBe(0);
    expect((await Ready.runSweep({ now: NOW + 15_000 })).sent).toBe(1);
  });

  it('only a portal request: a paper she asked for on WhatsApp already reached her there', async () => {
    const Ready = boot({ tables: readyPaper({ request: { surface: 'whatsapp' } }) });
    expect((await Ready.runSweep({ now: NOW })).sent).toBe(0);
  });

  it('an edited version is not a new paper to announce', async () => {
    const Ready = boot({ tables: readyPaper({ paper: { edited_from: 'x' } }) });
    expect((await Ready.runSweep({ now: NOW })).sent).toBe(0);
  });

  it('an old one (ready hours ago) is not chased: the sweep looks back an hour at most', async () => {
    const Ready = boot({ tables: readyPaper({ paper: { ready_at: iso(3 * 3600) }, request: { created_at: iso(3 * 3600 + 60) } }) });
    expect((await Ready.runSweep({ now: NOW })).sent).toBe(0);
  });
});

describe('a failure is in the app only', () => {
  it('a failed paper is never sent, however long it has been', async () => {
    const Ready = boot({ tables: readyPaper({ paper: { status: 'failed', ready_at: null, file_r2_key: null } }) });
    await Ready.runSweep({ now: NOW });
    await Ready.runSweep({ now: NOW + 600_000 });
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
  });

  it('a failed lesson render is never sent', async () => {
    const Ready = boot({ tables: readyLesson({ render: { status: 'failed', r2_key: null } }) });
    await Ready.runSweep({ now: NOW });
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
  });
});

describe('a grades 6-12 lesson plan she waited for', () => {
  it('is sent as lesson_plan_ready_v1 with its title, grade and subject, and recorded as received on WhatsApp', async () => {
    const Ready = boot({ tables: readyLesson() });
    const out = await Ready.runSweep({ now: NOW });
    expect(out.sent).toBe(1);
    const [, name, lang, components] = whatsapp.sendTemplate.mock.calls[0];
    expect([name, lang]).toEqual(['lesson_plan_ready_v1', 'en']);
    expect(components.find((c) => c.type === 'body').parameters.map((p) => p.text)).toEqual(['Speed', '9', 'Physics']);
    expect(components.find((c) => c.type === 'header').parameters[0].document).toEqual({
      link: 'https://r2.example/lp612/r1.pdf?sig=1', filename: 'Lesson plan - Grade 9 Physics - Speed.pdf',
    });
    // It really reached her WhatsApp, so it is a normal delivery: it appears where /quiz lists what she received.
    const recorded = fake.db.niete_lp612_deliveries.find((d) => d.surface === 'whatsapp');
    expect(recorded).toMatchObject({ user_id: TEACHER, render_id: RENDER, segment_id: 'phy9.c02.p010', lang: 'en', template_version: 'v9.3' });
  });

  it('the button lands on THAT plan, in its language', async () => {
    const Ready = boot({ tables: readyLesson({ delivery: { lang: 'ur' } }) });
    await Ready.runSweep({ now: NOW });
    const token = whatsapp.sendTemplate.mock.calls[0][3].find((c) => c.type === 'button').parameters[0].text;
    const { verifyPortalLink } = require('../../bot/shared/services/portal-link-token');
    expect(verifyPortalLink(token)).toMatchObject({ u: TEACHER, area: 'ready', i: 'lesson:phy9.c02.p010:ur' });
  });

  it('one she opened at once (a cache hit, delivered long after the render completed) is not "made for you"', async () => {
    const Ready = boot({ tables: readyLesson({ delivery: { delivered_at: iso(40) }, render: { completed_at: iso(5 * 3600) } }) });
    expect((await Ready.runSweep({ now: NOW })).sent).toBe(0);
  });

  it('one she opened by any way (niete_lp_opens since it was ready) is not sent', async () => {
    const Ready = boot({ tables: { ...readyLesson(), niete_lp_opens: [{ user_id: TEACHER, plan_kind: 'g612', plan_ref: 'phy9.c02.p010', lang: 'en', opened_at: iso(10) }] } });
    expect((await Ready.runSweep({ now: NOW })).sent).toBe(0);
  });

  it('seen (the banner\'s X) or opened or already sent: not sent', async () => {
    for (const over of [{ notice_seen_at: iso(20) }, { notice_opened_at: iso(20) }, { notice_whatsapp_at: iso(20) }]) {
      const Ready = boot({ tables: readyLesson({ delivery: over }) });
      expect((await Ready.runSweep({ now: NOW })).sent).toBe(0);
    }
  });
});

describe('who it is sent to, and in what language', () => {
  it('her preferred language at send time picks the template language; anything else is English', async () => {
    let Ready = boot({ tables: readyPaper(), users: [{ id: TEACHER, phone_number: '923001234567', preferred_language: 'ur' }] });
    await Ready.runSweep({ now: NOW });
    expect(whatsapp.sendTemplate.mock.calls[0][2]).toBe('ur');
    Ready = boot({ tables: readyPaper(), users: [{ id: TEACHER, phone_number: '923001234567', preferred_language: 'sw' }] });
    await Ready.runSweep({ now: NOW });
    expect(whatsapp.sendTemplate.mock.calls[0][2]).toBe('en');
  });

  it('no phone number, no message — and the item is NOT claimed, so it is not lost if a number appears', async () => {
    const Ready = boot({ tables: readyPaper(), users: [{ id: TEACHER, phone_number: null, preferred_language: 'en' }] });
    expect(await Ready.runSweep({ now: NOW })).toMatchObject({ sent: 0, skipped: 1 });
    expect(fake.db.assessment_requests[0].notice_whatsapp_at).toBeNull();
  });
});

describe('a refused send is not retried', () => {
  it('Meta refusing (sendTemplate false) is logged at ERROR, counted failed, and NOT tried again on the next sweep', async () => {
    const Ready = boot({ tables: readyPaper() });
    whatsapp.sendTemplate.mockResolvedValue(false);
    const first = await Ready.runSweep({ now: NOW });
    expect(first).toMatchObject({ claimed: 1, sent: 0, failed: 1 });
    expect(errors().some((l) => /portal_ready_whatsapp/.test(l.message))).toBe(true);
    await Ready.runSweep({ now: NOW + 60_000 });
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
  });

  it('a send that throws is the same: logged at error, counted, never thrown out of the sweep', async () => {
    const Ready = boot({ tables: readyPaper() });
    whatsapp.sendTemplate.mockRejectedValue(new Error('network'));
    await expect(Ready.runSweep({ now: NOW })).resolves.toMatchObject({ failed: 1, sent: 0 });
    expect(errors().length).toBeGreaterThan(0);
  });

  it('a failed lesson send does not record a WhatsApp delivery she never got', async () => {
    const Ready = boot({ tables: readyLesson() });
    whatsapp.sendTemplate.mockResolvedValue(false);
    await Ready.runSweep({ now: NOW });
    expect(fake.db.niete_lp612_deliveries.filter((d) => d.surface === 'whatsapp')).toEqual([]);
  });
});

describe('the sweep itself', () => {
  it('is bounded: at most LIMIT items a tick; the rest wait for the next', async () => {
    const reqs = Array.from({ length: 5 }, (_, i) => request({ id: `00000000-0000-4000-8000-00000000000${i}`, created_at: iso(120 + i) }));
    const papers = reqs.map((r, i) => paper({ id: `99999999-9999-4999-8999-99999999999${i}`, request_id: r.id, file_r2_key: `papers/${i}.pdf` }));
    const Ready = boot({ tables: { assessment_requests: reqs, assessment_papers: papers } });
    const first = await Ready.runSweep({ now: NOW, limit: 2 });
    expect(first.sent).toBe(2);
    const second = await Ready.runSweep({ now: NOW, limit: 2 });
    expect(second.sent).toBe(2);
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(4);
  });

  it('never throws: a query that fails is logged at error and the tick carries on', async () => {
    const Ready = boot({ tables: readyPaper() });
    const real = fake.from;
    fake.from = (t) => { if (t === 'assessment_requests') throw new Error('timeout'); return real(t); };
    await expect(Ready.runSweep({ now: NOW })).resolves.toBeDefined();
    expect(errors().length).toBeGreaterThan(0);
  });

  it('says what it did in ONE line per tick that did something, and nothing for an idle tick', async () => {
    let Ready = boot({ tables: {} });
    await Ready.runSweep({ now: NOW });
    expect(logs.filter((l) => l.message === 'portal_ready_whatsapp.sweep')).toEqual([]);
    Ready = boot({ tables: readyPaper() });
    await Ready.runSweep({ now: NOW });
    const lines = logs.filter((l) => l.message === 'portal_ready_whatsapp.sweep');
    expect(lines).toHaveLength(1);
    expect(lines[0].data).toMatchObject({ candidates: 1, claimed: 1, sent: 1, failed: 0, skipped: 0 });
  });

  it('reads narrowly: only the columns it needs, from partial-indexed filters, never a fat JSONB', async () => {
    const Ready = boot({ tables: readyPaper() });
    await Ready.runSweep({ now: NOW });
    const q = fake.queries.find((x) => x.table === 'assessment_requests' && x.op === 'select');
    expect(q.filters.map((f) => f.col)).toEqual(expect.arrayContaining(['surface', 'notice_seen_at', 'notice_opened_at', 'notice_whatsapp_at', 'created_at']));
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../bot/shared/services/portal-ready-whatsapp.service.js'), 'utf8');
    expect(src).not.toMatch(/exam_json|analysis_data|\.select\('\*'\)/);
  });
});

describe('scheduling (pre-merge Class P): a sweep that survives redeploys and has one owner', () => {
  const FAKE_WORKER = () => ({ isShuttingDown: false });

  it('registers a first run shortly after boot AND an interval, on the worker that owns the main queue only', () => {
    jest.useFakeTimers();
    try {
      const Ready = boot({ tables: readyPaper() });
      const spy = jest.spyOn(Ready, 'runSweep');
      const handle = Ready.scheduleSweep({ worker: FAKE_WORKER(), queues: new Set(['main']), runSweep: spy });
      expect(handle).toMatchObject({ enabled: true });
      jest.advanceTimersByTime(Ready.FIRST_RUN_MS - 1);
      expect(spy).not.toHaveBeenCalled();
      jest.advanceTimersByTime(2);
      expect(spy).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(Ready.SWEEP_EVERY_MS);
      expect(spy).toHaveBeenCalledTimes(2);
      handle.stop();
    } finally { jest.useRealTimers(); }
  });

  it('a service that does not own the main queue (the video worker) registers nothing', () => {
    jest.useFakeTimers();
    try {
      const Ready = boot({ tables: readyPaper() });
      const handle = Ready.scheduleSweep({ worker: FAKE_WORKER(), queues: new Set(['video']) });
      expect(handle).toEqual({ enabled: false, reason: 'main queue not owned' });
      expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
  });

  it('a worker that is shutting down does not start a tick', () => {
    jest.useFakeTimers();
    try {
      const Ready = boot({ tables: readyPaper() });
      const spy = jest.fn(async () => ({}));
      const worker = { isShuttingDown: true };
      const handle = Ready.scheduleSweep({ worker, queues: new Set(['main']), runSweep: spy });
      jest.advanceTimersByTime(Ready.FIRST_RUN_MS + Ready.SWEEP_EVERY_MS * 3);
      expect(spy).not.toHaveBeenCalled();
      handle.stop();
    } finally { jest.useRealTimers(); }
  });

  it('is wired into the always-on worker, behind the same queue gate, in the worker file itself', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../bot/workers/sqs-worker.js'), 'utf8');
    expect(src).toMatch(/portal-ready-whatsapp\.service/);
    expect(src).toMatch(/scheduleSweep\(\{[^}]*worker[^}]*queues/);
  });
});
