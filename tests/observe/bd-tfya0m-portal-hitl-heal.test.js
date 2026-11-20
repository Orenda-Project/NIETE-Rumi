'use strict';
/**
 * bd-tfya0m (queue #205) — the portal HITL observation's server side, from three production failures on 19 Nov:
 *
 * 1. The debrief guide (POST /leader/observe/:id/talk/guide) came back 502 after 10 s for a coach while the bot was
 *    restarting for a deploy (bot "server started" 13:48:58 UTC, workers booting 13:49:21; the 502 at 13:49:15). The
 *    coach left, and the teacher's report was never sent. The portal's relay now asks the bot once more when the bot could
 *    not be reached or its proxy answered 502/503/504: the guide is built once and kept on the observation, and an ask
 *    while it is being written shares that one write, so a second ask is safe. A timeout is not asked again (the
 *    page's own asks again cover a slow guide), and an answer (2xx/4xx) is never asked again.
 *
 * 2. Draft saves on an observation with NO analysis (a WhatsApp observation left at awaiting_observer_review with
 *    analysis_data null) threw "Cannot read properties of null (reading 'domains')" in applyObserverEdits → 500 → the
 *    portal's 502, three times. There is no report to check without an analysis: getDraft and saveDraft now answer
 *    not_ready 'no_analysis' (409, the page says so) and never call the save.
 */

const SVC = '../../bot/shared/services/observe/portal-observe.service';

const COACH = 'c0ac0000-0000-4000-8000-000000000001';
const SID = 'cs-no-analysis';

function fakeSupabase(answer) {
  const from = (table) => {
    const q = { table, filters: {} };
    const self = new Proxy(q, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'eq') return (c, v) => { target.filters[c] = v; return self; };
        if (prop === 'single' || prop === 'maybeSingle') {
          return async () => {
            const fn = answer[table];
            const data = typeof fn === 'function' ? fn(target.filters) : (fn ?? null);
            return { data: Array.isArray(data) ? (data[0] || null) : data, error: null };
          };
        }
        if (prop === 'then') {
          return (res, rej) => {
            const fn = answer[table];
            const data = typeof fn === 'function' ? fn(target.filters) : (fn ?? null);
            return Promise.resolve({ data, error: null }).then(res, rej);
          };
        }
        return () => self;
      },
    });
    return self;
  };
  return { from };
}

const row = (over = {}) => ({
  id: SID,
  observer_user_id: COACH,
  observation_type: 'leader_observation',
  status: 'awaiting_observer_review',
  debrief_status: 'pending',
  framework: null,
  analysis_data: null,
  ...over,
});

function deps(r) {
  return {
    supabase: fakeSupabase({
      users: () => ({ id: COACH, role: 'coach', name: 'Test Coach', preferred_language: 'en', phone_number: '923330000000' }),
      coaching_sessions: () => r,
    }),
    draft: {
      applyObserverEdits: jest.fn().mockResolvedValue({ indicators_rescored: 1 }),
      buildScreenPrefill: jest.fn(() => ({})),
      FIDELITY_VERDICT_OPTIONS: [],
    },
    pack: () => ({ domainOrder: [], domains: {}, scaleOptions: [] }),
    languageFor: jest.fn().mockResolvedValue('en'),
    state: { getState: jest.fn().mockResolvedValue(null), clearState: jest.fn() },
    debrief: { buildDebriefGuide: jest.fn(), mergeObserverDebrief: jest.fn() },
    log: jest.fn(),
  };
}

describe('an observation with no analysis has no draft to check (prod 19 Nov: null.domains → 502)', () => {
  let Svc;
  beforeEach(() => { jest.resetModules(); Svc = require(SVC); });

  test('saveDraft answers not_ready no_analysis and never calls the save', async () => {
    const d = deps(row());
    const out = await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: { r_C1: '3' } }, d);
    expect(out).toEqual({ status: 'not_ready', reason: 'no_analysis' });
    expect(d.draft.applyObserverEdits).not.toHaveBeenCalled();
  });

  test('getDraft answers not_ready no_analysis (the page says so, rather than an empty form)', async () => {
    const d = deps(row());
    expect(await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, d)).toEqual({ status: 'not_ready', reason: 'no_analysis' });
  });

  test('an observation WITH its analysis saves as before', async () => {
    const d = deps(row({ analysis_data: { framework: 'fico', domains: { a: { indicators: [] } } } }));
    expect(await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: { r_C1: '3' } }, d)).toMatchObject({ status: 'ok' });
    expect(d.draft.applyObserverEdits).toHaveBeenCalledTimes(1);
  });
});

describe('the portal relay asks for the debrief guide again when the bot could not answer (prod 19 Nov: deploy restart)', () => {
  const CLIENT = '../../dashboard/services/portal-coaching.client';
  let post;
  let client;
  const reset = (code) => Object.assign(new Error(`connect ${code}`), { code });
  const proxy = (status) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });

  beforeEach(() => {
    jest.resetModules();
    process.env.MAIN_BOT_URL = 'https://bot.example';
    process.env.INTERNAL_API_KEY = 'secret';
    post = jest.fn();
    jest.doMock('axios', () => ({ post }));
    client = require(CLIENT);
    client._setRetryWaitMs(0);
  });
  afterEach(() => { jest.dontMock('axios'); });

  test.each([['ECONNRESET'], ['ECONNREFUSED'], ['EPIPE']])('%s, then the guide: the guide comes back', async (code) => {
    post.mockRejectedValueOnce(reset(code)).mockResolvedValueOnce({ status: 200, data: { status: 'ok', guide: { intro: 'x' } } });
    const out = await client.observationTalkGuide({ userId: COACH, coachingSessionId: SID });
    expect(out).toEqual({ httpStatus: 200, body: { status: 'ok', guide: { intro: 'x' } } });
    expect(post).toHaveBeenCalledTimes(2);
  });

  test.each([[502], [503], [504]])('the proxy answered %s, then the guide', async (status) => {
    post.mockRejectedValueOnce(proxy(status)).mockResolvedValueOnce({ status: 200, data: { status: 'ok', guide: null } });
    await expect(client.observationTalkGuide({ userId: COACH, coachingSessionId: SID })).resolves.toMatchObject({ httpStatus: 200 });
    expect(post).toHaveBeenCalledTimes(2);
  });

  test('asked once more, not forever: two failures throw (the route answers 502; the page asks again later)', async () => {
    post.mockRejectedValue(reset('ECONNRESET'));
    await expect(client.observationTalkGuide({ userId: COACH, coachingSessionId: SID })).rejects.toThrow();
    expect(post).toHaveBeenCalledTimes(2);
  });

  test('a timeout is not asked again (the guide may still be writing; the page asks again)', async () => {
    post.mockRejectedValue(Object.assign(new Error('timeout of 100000ms exceeded'), { code: 'ECONNABORTED' }));
    await expect(client.observationTalkGuide({ userId: COACH, coachingSessionId: SID })).rejects.toThrow();
    expect(post).toHaveBeenCalledTimes(1);
  });

  test('a 4xx answer is an answer: not asked again', async () => {
    post.mockResolvedValue({ status: 409, data: { status: 'not_ready', reason: 'draft_not_saved' } });
    await expect(client.observationTalkGuide({ userId: COACH, coachingSessionId: SID })).resolves.toMatchObject({ httpStatus: 409 });
    expect(post).toHaveBeenCalledTimes(1);
  });

  test('the report send is NOT asked again by the relay (a second ask could queue a second delivery)', async () => {
    post.mockRejectedValue(reset('ECONNRESET'));
    await expect(client.sendObservationReport({ userId: COACH, coachingSessionId: SID })).rejects.toThrow();
    expect(post).toHaveBeenCalledTimes(1);
  });
});

/**
 * The report to the teacher is never left hanging. Before: previewReport marked the delivery 'previewing' and THEN
 * queued; a queue failure (the queue unreachable during a deploy) threw → 502, and the page showed "Making the report"
 * for ever (step report, preparing). sendReport the same with send_requested_at → "Sending" for ever. Now the queue is
 * asked once more; if it still fails the delivery is marked send_failed — the page's "Report not sent" with Try again —
 * and the route answers queue_failed (502).
 */
describe('the report is never left preparing or sending when it could not be queued', () => {
  let Svc;
  beforeEach(() => { jest.resetModules(); Svc = require(SVC); });

  const DONE = row({
    status: 'observer_review_complete', debrief_status: 'done',
    analysis_data: { framework: 'fico', domains: { a: {} }, teacher_delivery: {} },
  });
  const AWAITING = row({
    status: 'observer_review_complete', debrief_status: 'done',
    analysis_data: { framework: 'fico', domains: { a: {} }, teacher_delivery: { status: 'awaiting_confirm', report_key: 'r/k.png', teacher_phone: '923990000001' } },
  });

  function reportDeps(r, queueImpl) {
    const d = deps(r);
    d.people = { isBound: () => true, teacherOf: jest.fn().mockResolvedValue({ name: 'Test Teacher', phone: '923990000001' }) };
    d.roster = { upsertTeacher: jest.fn().mockResolvedValue({}) };
    d.send = { mergeTeacherDelivery: jest.fn().mockResolvedValue({}) };
    d.queue = { queueObserveTeacherReport: jest.fn(queueImpl) };
    d.now = () => new Date('2026-11-20T10:00:00Z');
    d.newId = () => 'nonce-1';
    d.retryWaitMs = 0;
    return d;
  }
  const lastDelivery = (d) => d.send.mergeTeacherDelivery.mock.calls[d.send.mergeTeacherDelivery.mock.calls.length - 1][1];

  test('preview: the queue fails once, then takes it — ok, queued twice', async () => {
    let n = 0;
    const d = reportDeps(DONE, async () => { n += 1; if (n === 1) throw new Error('queue unreachable'); return {}; });
    expect(await Svc.previewReport({ userId: COACH, coachingSessionId: SID }, d)).toEqual({ status: 'ok' });
    expect(d.queue.queueObserveTeacherReport).toHaveBeenCalledTimes(2);
    expect(lastDelivery(d)).toMatchObject({ status: 'previewing' });
  });

  test('preview: the queue fails every time — queue_failed, and the delivery is send_failed (not "preparing" for ever)', async () => {
    const d = reportDeps(DONE, async () => { throw new Error('queue unreachable'); });
    expect(await Svc.previewReport({ userId: COACH, coachingSessionId: SID }, d)).toMatchObject({ status: 'queue_failed' });
    expect(lastDelivery(d)).toMatchObject({ status: 'send_failed', send_requested_at: null });
  });

  test('send: the queue fails once, then takes it — ok', async () => {
    let n = 0;
    const d = reportDeps(AWAITING, async () => { n += 1; if (n === 1) throw new Error('queue unreachable'); return {}; });
    expect(await Svc.sendReport({ userId: COACH, coachingSessionId: SID }, d)).toEqual({ status: 'ok' });
    expect(d.queue.queueObserveTeacherReport).toHaveBeenCalledTimes(2);
  });

  test('send: the queue fails every time — queue_failed, and the delivery is send_failed (not "sending" for ever)', async () => {
    const d = reportDeps(AWAITING, async () => { throw new Error('queue unreachable'); });
    expect(await Svc.sendReport({ userId: COACH, coachingSessionId: SID }, d)).toMatchObject({ status: 'queue_failed' });
    expect(lastDelivery(d)).toMatchObject({ status: 'send_failed', send_requested_at: null });
  });

  test('a send_failed delivery reads as "Report not sent" with Try again (step report, problem send_failed)', () => {
    const { observeStep } = require('../../bot/shared/services/observe/portal-observe-step');
    expect(observeStep({ status: 'observer_review_complete', debriefStatus: 'done', deliveryStatus: 'send_failed' }))
      .toEqual({ step: 'report', problem: 'send_failed', preparing: false });
  });
});
