'use strict';
/**
 * "Make a quiz" is made INSIDE the page the closed-window report opens (/cq, and the /cr quiz block): no message to the
 * bot, no message to the teacher. The page posts to itself, the portal asks the bot (/api/internal/rq), the bot runs the
 * same offer → generate → hand-off path as a WhatsApp tap, with every WhatsApp send left out, and the page shows
 * making → (language ask) → ready: the class message with Copy and Send always on screen, the questions with the key
 * marked, the PDF and the student's view.
 *
 * Real modules end to end: the portal's coaching-report routes and page, the bot's internal route, report-page-quiz,
 * the offer service, closed-window-offer, the hand-off. Stubbed: Supabase (in-memory tables shared by portal and bot),
 * the WhatsApp boundary, the queue, the digest model call, R2 and the PDF renderer, the share-code mint, the loggers.
 */
process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';

jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a), rpc: (...a) => mockDb.rpc(...a) }));
jest.mock('../../dashboard/config/supabase', () => ({ from: (...a) => mockDb.from(...a), rpc: (...a) => mockDb.rpc(...a) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendVideoWithButtons: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendReaction: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/quiz/quiz-delivery.service', () => ({ _hasOpenMessageWindow: jest.fn().mockResolvedValue(false) }));
jest.mock('../../bot/shared/services/feature-intro.service', () => ({
  hasSeenIntroVideo: jest.fn().mockResolvedValue(false),
  introShownCount: jest.fn().mockResolvedValue(5),
  markVideoShown: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-digest.service', () => ({ run: jest.fn() }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'Sadia Noor' }),
  botNumber: jest.fn().mockReturnValue('923206281951'),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'),
  downloadFromR2: jest.fn().mockRejectedValue(new Error('absent')),
  getPresignedGetUrl: jest.fn().mockResolvedValue('https://r2.example/signed.pdf'),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../dashboard/services/telemetry.service', () => ({ logEvent: jest.fn(), flush() {}, isEnabled: () => true }));
jest.mock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });

const http = require('http');
const express = require('express');
const { makeDb } = require('../quiz/helpers/memory-db');

let mockDb;
const WhatsApp = require('../../bot/shared/services/whatsapp.service');
const Queue = require('../../bot/shared/services/queue');
const Digest = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');
const { logEvent: botEvent } = require('../../bot/shared/utils/structured-logger');
const { logEvent: portalEvent } = require('../../dashboard/services/telemetry.service');

const SID = 'a1b2c3d4-1111-4111-8111-000000000001';
const UID = 'b0ffe250-0000-4000-8000-0000000000a1';
const OTHER_UID = 'b0ffe250-0000-4000-8000-0000000000a2';
const PHONE = '923330000011';
const QID = 'c0ffe250-0000-4000-8000-0000000000c1';
const ON = { key: 'quiz_offer_closed_window', value: { trace: true, report_page: true } };
const ENV = { ...process.env };
const HELD = { id: QID, coaching_session_id: SID, quiz_source: 'transcript', status: 'skipped', teacher_id: UID, topic: 'Adding tens',
  created_at: '2026-11-25T08:00:00Z', meta: { step: 'skipped', skip_reason: 'window_closed', held_path: 'template' } };
const DIGEST = (subject) => ({
  digest: { topic: 'Adding tens', subject, confidence: 0.9, language_of_instruction: 'en', slos: [{ id: 'S1' }, { id: 'S2' }], key_terms: [] },
  grade: '3', gradeSource: 'profile', lpHint: null, model: 'm', costUsd: 0.01,
});
const QUESTIONS = Array.from({ length: 8 }, (_, i) => ({
  id: `qq-${i}`, quiz_id: QID, sort_order: i, question_text: `Question ${i + 1}: what is ${i + 1} tens?`,
  option_a: `${i + 1}0`, option_b: `${i + 1}`, option_c: `${i + 1}00`, option_d: null, correct_option: 'A', external_id: `tq:${QID}:S1:${i}`,
}));

/** The in-memory tables, with the one-transcript-quiz-per-session unique index (23505) the offer's claim relies on. */
function withQuizIndex(db) {
  const from = db.from;
  return {
    ...db,
    from: (table) => {
      const chain = from(table);
      if (table !== 'quizzes') return chain;
      const insert = chain.insert;
      chain.insert = (r) => {
        const dup = r && r.quiz_source === 'transcript' && db.tables.quizzes
          .some((q) => q.coaching_session_id === r.coaching_session_id && q.quiz_source === 'transcript');
        if (!dup) return insert(r);
        const out = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        const refused = { select: () => refused, single: () => refused, maybeSingle: () => refused, then: (res, rej) => Promise.resolve(out).then(res, rej) };
        return refused;
      };
      return chain;
    },
  };
}

function seed({ settings = [ON], quizzes = [{ ...HELD, meta: { ...HELD.meta } }], language = 'en', questions = [] } = {}) {
  mockDb = withQuizIndex(makeDb({
    users: [{ id: UID, name: 'Sadia Noor', phone_number: PHONE, preferred_language: language },
      { id: OTHER_UID, name: 'Other', phone_number: '923330000099', preferred_language: 'en' }],
    app_settings: [...settings, { key: 'web_quiz_enabled', value: true }, { key: 'web_quiz_teachers', value: 'all' }],
    coaching_sessions: [{
      id: SID, user_id: UID, status: 'completed', observation_type: null, transcript_text: 'x'.repeat(2000), transcript_language: 'en',
      analysis_data: { topic: 'Adding tens', subject: 'Maths' }, created_at: '2026-11-25T07:00:00Z',
      users: { id: UID, name: 'Sadia Noor', phone_number: PHONE, preferred_language: language },
    }],
    quizzes,
    quiz_questions: questions,
  }));
}

let servers = [];
async function listen(app) {
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  servers.push(srv);
  return srv.address().port;
}

/** The bot's internal route and the portal, wired as on Railway: the portal reaches the bot by MAIN_BOT_URL + key. */
async function start() {
  require('../../bot/shared/services/quiz/report-page-quiz')._resetCache();
  require('../../bot/shared/services/quiz/closed-window-offer')._resetCache();
  const bot = express();
  bot.use('/api/internal/rq', require('../../bot/shared/routes/report-quiz-internal.routes'));
  const botPort = await listen(bot);
  process.env.MAIN_BOT_URL = `http://127.0.0.1:${botPort}`;
  const portal = express();
  portal.use(require('../../dashboard/routes/coaching-report.routes').createCoachingReportRouter({
    groupOf: async () => null,
    deliverySwitch: async () => ({ linkTemplate: null, tipWording: false, timeOnPage: false }),
  }));
  const port = await listen(portal);
  const token = (userId = UID) => require('../../bot/shared/services/coaching/report-link-token').signReportLink({ sessionId: SID, userId });
  const req = (method, path, { body, json = false } = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? null : (json ? JSON.stringify(body) : new URLSearchParams(body).toString());
    const r = http.request({
      host: '127.0.0.1', port, path, method,
      headers: {
        ...(data ? { 'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
  return { token, req };
}

const jobs = (type) => Queue.queueJob.mock.calls.filter((c) => c[1] === type);
async function quizRow() {
  const { data } = await require('../../bot/shared/config/supabase').from('quizzes').select('*').eq('id', QID).maybeSingle();
  return data;
}
const botEvents = (name) => botEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
const portalEvents = (name) => portalEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
const noWhatsApp = () => {
  for (const fn of Object.values(WhatsApp)) expect(fn).not.toHaveBeenCalled();
};
const unAmp = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV, TRANSCRIPT_QUIZ_ENABLED: 'true', INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co',
    WHATSAPP_BOT_NUMBER: '923206281951', WEB_QUIZ_BASE_URL: 'https://portal.example', WEB_QUIZ_TOKEN_SECRET: 's'.repeat(40) };
  const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
  jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
});
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });
afterAll(() => { process.env = ENV; });

/** The worker's turn: the queued quiz_offer job, exactly as sqs-worker.js runs it. */
async function runOfferJob() {
  const [job] = jobs('quiz_offer');
  expect(job).toBeDefined();
  const p = job[2];
  return require('../../bot/shared/services/quiz/transcript-quiz-offer.service').processOffer(p.coachingSessionId, p);
}

describe('held offer: the page makes the quiz itself', () => {
  test('/cq held → "Make a quiz" is a form that posts to the page, never a wa.me prefill', async () => {
    seed();
    const { token, req } = await start();
    const t = token();
    const r = await req('GET', `/cq/${t}`);
    expect(r.status).toBe(200);
    expect(r.body).toContain(`<form method="post" action="/cq/${t}/make"`);
    expect(r.body).toMatch(/<button[^>]*class="btn"[^>]*>Make a quiz<\/button>/);
    expect(r.body).not.toMatch(/CR-a1b2c3d4/i);
    expect(r.body).not.toContain('wa.me/923206281951?text=');
  });

  test('tap → making → ready with no WhatsApp message at any step; the page then shows the class message, Copy, Send, the questions, PDF, student view', async () => {
    seed({ questions: QUESTIONS });
    const { token, req } = await start();
    const t = token();

    const tap = await req('POST', `/cq/${t}/make`, { body: { surface: 'cq' } });
    expect(tap.status).toBe(303);
    expect(tap.headers.location).toBe(`/cq/${t}`);
    expect(jobs('quiz_offer')).toHaveLength(1);
    expect(jobs('quiz_offer')[0][2]).toEqual(expect.objectContaining({ coachingSessionId: SID, page: true, accepted: true }));
    expect(botEvents('transcript_quiz.page_make_tap')).toEqual([expect.objectContaining({ coachingSessionId: SID, surface: 'cq' })]);

    const making = await req('GET', `/cq/${t}`);
    expect(making.body).toContain('Making your quiz');
    expect(making.body).toContain(`b="/cq/${t}"`); // the page polls its own state: b + '/state'
    expect(making.body).toContain("b+'/state'");

    // Urdu lesson: no language ask (needsLanguageAsk false) → straight to generating
    Digest.run.mockResolvedValue(DIGEST('urdu'));
    await runOfferJob();
    let q = await quizRow();
    expect(q.status).toBe('generating');
    expect(q.meta.made_via).toBe('page');
    const [gen] = jobs('quiz_generate');
    expect(gen[2].phone).toBe(require('../../bot/shared/services/quiz/report-page-quiz').PAGE_NO_SEND);

    // the worker's generate step is done: the questions are written and the row is ready
    await require('../../bot/shared/config/supabase').from('quizzes').update({ status: 'ready', meta: { ...q.meta, step: 'ready' } }).eq('id', QID);
    const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
    const out = await Handoff.sendHandoff(QID, gen[2].phone, { firstSend: true });
    expect(out.ok).toBe(true);
    q = await quizRow();
    expect(q.status).toBe('sent');
    expect(q.meta.delivered_via).toBe('page');
    expect(q.meta.student_message).toEqual(expect.stringContaining('ABC234'));
    expect(q.meta.pdf_key).toBeTruthy();
    expect(jobs('quiz_nudge_teacher')).toHaveLength(0); // no WhatsApp nudge for a page-made quiz
    expect(botEvents('transcript_quiz.page_make_ready')).toEqual([expect.objectContaining({ quizId: QID, ms: expect.any(Number) })]);
    noWhatsApp();

    const ready = await req('GET', `/cq/${t}`);
    const html = unAmp(ready.body);
    expect(html).toContain(q.meta.student_message.split('\n')[0]);
    expect(html).toMatch(/<button[^>]*data-copy[^>]*>Copy message<\/button>/);
    expect(html).toContain(`href="https://wa.me/?text=${encodeURIComponent(q.meta.student_message)}"`);
    expect(html).toMatch(/class="qbar"/); // the bar that stays on screen
    expect(html).toContain('See the questions (8)');
    expect((html.match(/class="qitem"/g) || [])).toHaveLength(8);
    expect((html.match(/class="qopt ok"/g) || [])).toHaveLength(8); // one key marked per question
    expect(html).toContain('Correct answer');
    expect(html).toContain(`href="/cq/${t}/pdf"`);
    expect(html).toContain(`href="/cq/${t}/try"`);
    // the message the teacher copies or shares names the children's link only, never the teacher's page
    expect(q.meta.student_message).not.toMatch(/\/c[qr]\//);
  });

  test('the same quiz handed out to a WhatsApp phone keeps today\'s hand-off: PDF, the link alone, then the report promise as its own message', async () => {
    seed({ questions: QUESTIONS });
    const { token, req } = await start();
    await req('POST', `/cq/${token()}/make`, { body: { surface: 'cq' } });
    Digest.run.mockResolvedValue(DIGEST('urdu'));
    await runOfferJob();
    const q = await quizRow();
    await require('../../bot/shared/config/supabase').from('quizzes').update({ status: 'ready', meta: { ...q.meta, step: 'ready' } }).eq('id', QID);
    const { resolveUx } = require('../../bot/shared/config/ux-strings');
    const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
    for (const fn of Object.values(WhatsApp)) fn.mockClear(); // only the hand-off's own sends are read below

    const out = await Handoff.sendHandoff(QID, PHONE, { firstSend: true });
    expect(out.ok).toBe(true);
    expect(WhatsApp.sendDocument).toHaveBeenCalledTimes(1);
    expect(WhatsApp.sendDocument.mock.calls[0][0]).toBe(PHONE);
    const texts = WhatsApp.sendMessage.mock.calls.map((c) => c[1]);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain('ABC234');
    expect(texts[1]).toBe(resolveUx('tqReportPromise', { language: 'en' }));
    expect((await quizRow()).meta.delivered_via).toBeUndefined();
  });

  test('language ask on the page: two buttons, the choice goes to generating, still no WhatsApp message', async () => {
    seed();
    const { token, req } = await start();
    const t = token();
    await req('POST', `/cq/${t}/make`, { body: { surface: 'cq' } });
    Digest.run.mockResolvedValue(DIGEST('maths'));
    await runOfferJob();
    let q = await quizRow();
    expect(q.status).toBe('offered');
    expect(q.meta.awaiting_language).toBe(true);

    const ask = await req('GET', `/cq/${t}`);
    expect(ask.body).toContain('Which language should the quiz be in?');
    expect((ask.body.match(new RegExp(`<form method="post" action="/cq/${t}/lang"`, 'g')) || [])).toHaveLength(2);
    expect(ask.body).toMatch(/name="language" value="en"/);
    expect(ask.body).toMatch(/name="language" value="ur"/);

    const pick = await req('POST', `/cq/${t}/lang`, { body: { language: 'en', surface: 'cq' } });
    expect(pick.status).toBe(303);
    q = await quizRow();
    expect(q.status).toBe('generating');
    expect(q.language).toBe('en');
    expect(jobs('quiz_generate')[0][2].phone).toBe(require('../../bot/shared/services/quiz/report-page-quiz').PAGE_NO_SEND);
    noWhatsApp();
  });

  test('a subject we do not quiz → the page names that, and the teacher is sent nothing', async () => {
    process.env.TRANSCRIPT_QUIZ_SUBJECTS = 'maths,science,english,urdu';
    seed();
    const { token, req } = await start();
    const t = token();
    await req('POST', `/cq/${t}/make`, { body: { surface: 'cq' } });
    Digest.run.mockResolvedValue(DIGEST('art'));
    await runOfferJob();
    const r = await req('GET', `/cq/${t}`);
    expect(r.body).toContain('We do not make quizzes for this subject yet');
    expect(botEvents('transcript_quiz.page_make_failed')).toEqual([expect.objectContaining({ reason: 'subject_not_allowed' })]);
    noWhatsApp();
  });

  test('a generation failure on a page-made quiz is logged, never sent', async () => {
    seed();
    const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
    const { PAGE_NO_SEND } = require('../../bot/shared/services/quiz/report-page-quiz');
    await Gen.tellTeacherFailed(PAGE_NO_SEND, 'en', QID, 'model_failed', 'transcript', { step: 'author' });
    noWhatsApp();
    expect(botEvents('transcript_quiz.page_make_failed')).toEqual([expect.objectContaining({ quizId: QID, reason: 'generate_failed', cause: 'model_failed' })]);
  });

  test('a token for someone else\'s session → nothing queued (the portal 404s, the bot refuses not_owner)', async () => {
    seed();
    const { token, req } = await start();
    const r = await req('POST', `/cq/${token(OTHER_UID)}/make`, { body: { surface: 'cq' } });
    expect(r.status).toBe(404);
    expect(Queue.queueJob).not.toHaveBeenCalled();
    // the bot route itself, asked directly with a mismatched teacher
    const botRes = await fetch(`${process.env.MAIN_BOT_URL}/api/internal/rq/make`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'k1' }, body: JSON.stringify({ sessionId: SID, userId: OTHER_UID, surface: 'cq' }),
    });
    expect(botRes.status).toBe(404);
    expect(Queue.queueJob).not.toHaveBeenCalled();
    // once through the portal, once asked directly
    expect(botEvents('transcript_quiz.page_make_failed')).toEqual([
      expect.objectContaining({ reason: 'not_owner' }), expect.objectContaining({ reason: 'not_owner' })]);
  });

  test('the bot route refuses a caller without the internal key', async () => {
    seed();
    await start();
    const r = await fetch(`${process.env.MAIN_BOT_URL}/api/internal/rq/make`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: SID, userId: UID }),
    });
    expect(r.status).toBe(401);
    expect(Queue.queueJob).not.toHaveBeenCalled();
  });

  test('switch off → make is 404 and nothing is queued', async () => {
    seed({ settings: [] });
    const { token, req } = await start();
    expect((await req('POST', `/cq/${token()}/make`, { body: {} })).status).toBe(404);
    expect(Queue.queueJob).not.toHaveBeenCalled();
  });
});

describe('ready: the page\'s own taps are logged once, server-side', () => {
  const SENT = { ...HELD, status: 'sent', language: 'en',
    meta: { step: 'sent', made_via: 'page', delivered_via: 'page', share_code: 'ABC234', share_code_id: 'sc-1',
      student_message: 'Class quiz on Adding tens: https://portal.example/q/ABC234', pdf_key: 'transcript_quizzes/u/q.pdf' } };

  test('copy / share / view_questions beacons → transcript_quiz.page_* with the surface; anything else 400', async () => {
    seed({ quizzes: [SENT], questions: QUESTIONS });
    const { token, req } = await start();
    const t = token();
    expect((await req('POST', `/cq/${t}/e`, { json: true, body: { ev: 'copy', surface: 'cq', fallback: true } })).status).toBe(204);
    expect((await req('POST', `/cq/${t}/e`, { json: true, body: { ev: 'share', surface: 'cr' } })).status).toBe(204);
    expect((await req('POST', `/cq/${t}/e`, { json: true, body: { ev: 'view_questions', surface: 'cq' } })).status).toBe(204);
    expect((await req('POST', `/cq/${t}/e`, { json: true, body: { ev: 'make_timeout', surface: 'cq' } })).status).toBe(204);
    expect((await req('POST', `/cq/${t}/e`, { json: true, body: { ev: 'drop_table', surface: 'cq' } })).status).toBe(400);
    // what the page's own beacon sends: form-encoded, a CORS-safelisted type sendBeacon never refuses
    expect((await req('POST', `/cq/${t}/e`, { body: { ev: 'copy', surface: 'cr', fallback: 'false' } })).status).toBe(204);
    expect(portalEvents('transcript_quiz.page_copy')).toEqual([
      expect.objectContaining({ surface: 'cq', fallback: true, coachingSessionId: SID }),
      expect.objectContaining({ surface: 'cr', fallback: false })]);
    expect(portalEvents('transcript_quiz.page_share')).toEqual([expect.objectContaining({ surface: 'cr' })]);
    expect(portalEvents('transcript_quiz.page_view_questions')).toHaveLength(1);
    expect(portalEvents('transcript_quiz.page_make_failed')).toEqual([expect.objectContaining({ reason: 'timeout' })]);
  });

  test('Download PDF → 302 to a signed link; Try it as a student → 302 to the preview; both logged', async () => {
    seed({ quizzes: [SENT], questions: QUESTIONS });
    const { token, req } = await start();
    const t = token();
    const pdf = await req('GET', `/cq/${t}/pdf`);
    expect(pdf.status).toBe(302);
    expect(pdf.headers.location).toBe('https://r2.example/signed.pdf');
    const tryIt = await req('GET', `/cq/${t}/try`);
    expect(tryIt.status).toBe(302);
    expect(tryIt.headers.location).toMatch(/^https:\/\/portal\.example\/q\/ABC234\?p=/);
    expect(portalEvents('transcript_quiz.page_pdf')).toHaveLength(1);
    expect(portalEvents('transcript_quiz.page_try')).toHaveLength(1);
  });

  test('the message box: the link is one unbroken LTR run (a split quiz code reads as broken), the copy source is the exact message, nothing looks editable', async () => {
    seed({ quizzes: [SENT], questions: QUESTIONS, language: 'ur' });
    const { token, req } = await start();
    const r = await req('GET', `/cq/${token()}`);
    expect(r.body).toContain('<bdi dir="ltr" class="qurl">https://portal.example/q/ABC234</bdi>');
    expect(r.body).toMatch(/\.qurl\{[^}]*white-space:nowrap/);
    // what Copy reads: the stored message, whole, in a field the teacher never sees or edits
    expect(r.body).toMatch(/<textarea id="qmsg" class="qsrc" readonly tabindex="-1" aria-hidden="true">Class quiz on Adding tens: https:\/\/portal\.example\/q\/ABC234<\/textarea>/);
    expect(r.body).not.toMatch(/resize:vertical/);
  });

  test('Urdu: questions numbered in Urdu digits, «واٹس ایپ» held together by U+00A0', async () => {
    seed({ quizzes: [SENT], questions: QUESTIONS, language: 'ur' });
    const { token, req } = await start();
    const r = await req('GET', `/cq/${token()}`);
    expect(r.body).toContain('۸'); // the count and the last number
    expect(r.body).toMatch(/class="qn">۱\./);
    expect(r.body).not.toMatch(/واٹس ایپ/); // a plain space would let the button break at 360 px
    expect(r.body).toContain('واٹس ایپ');
  });

  test('/cr: the held block is the same make form (surface cr); a page-made quiz gets the full ready block', async () => {
    seed();
    let { token, req } = await start();
    let r = await req('GET', `/cr/${token()}`);
    expect(r.status).toBe(200);
    expect(r.body).toContain(`<form method="post" action="/cq/${token()}/make"`);
    expect(r.body).toContain('name="surface" value="cr"');

    await Promise.all(servers.map((s) => new Promise((res) => s.close(res)))); servers = [];
    seed({ quizzes: [SENT], questions: QUESTIONS });
    ({ token, req } = await start());
    r = await req('GET', `/cr/${token()}`);
    expect(r.body).toMatch(/class="qbar"/);
    expect(r.body).toContain('See the questions (8)');
  });

  test('/cr: a quiz made in WhatsApp keeps today\'s section (no page block)', async () => {
    seed({ quizzes: [{ ...SENT, meta: { ...SENT.meta, made_via: undefined, delivered_via: undefined } }], questions: QUESTIONS });
    const { token, req } = await start();
    const r = await req('GET', `/cr/${token()}`);
    expect(r.body).toContain('Class quiz on Adding tens');
    expect(r.body).not.toMatch(/class="qbar"/);
  });
});

describe('no block, the door, and the gates (the switch, the token)', () => {
  test.each([
    ['switch off (no row)', { settings: [] }],
    ['switch row without report_page', { settings: [{ key: 'quiz_offer_closed_window', value: { trace: true } }] }],
    ['no quiz row', { quizzes: [] }],
    ['a quiz being made in WhatsApp (not the page\'s)', { quizzes: [{ ...HELD, status: 'generating', meta: { step: 'author' } }] }],
    ['skipped for another reason', { quizzes: [{ ...HELD, meta: { skip_reason: 'transcript_too_short' } }] }],
  ])('/cr, %s → today\'s report, no quiz block', async (_name, opts) => {
    seed(opts);
    const { token, req } = await start();
    const r = await req('GET', `/cr/${token()}`);
    expect(r.status).toBe(200);
    expect(r.body).not.toContain('class="qz"');
    expect(r.body).not.toContain('Make a quiz');
  });

  test('/cq, neither held nor made → the /quiz door, with a way to WhatsApp', async () => {
    seed({ quizzes: [] });
    const { token, req } = await start();
    const r = await req('GET', `/cq/${token()}`);
    expect(r.status).toBe(200);
    expect(r.body).toContain('/quiz');
    expect(r.body).not.toContain('>Make a quiz<');
    expect(unAmp(r.body)).toContain('href="https://wa.me/923206281951?text=%2Fquiz"');
  });

  test('/cq, neither, in Urdu: one noun on the page (کوئز), never the Latin "quiz" in Urdu prose', async () => {
    seed({ quizzes: [], language: 'ur' });
    const { token, req } = await start();
    const r = await req('GET', `/cq/${token()}`);
    const prose = r.body.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\/quiz/g, '');
    expect(prose).toContain('کوئز');
    expect(prose).not.toMatch(/\bquiz\b/i);
  });

  test('/cq: switch off → 404 (link not complete); a bad token → 404', async () => {
    seed({ settings: [] });
    const { token, req } = await start();
    expect((await req('GET', `/cq/${token()}`)).status).toBe(404);
    expect((await req('GET', '/cq/not-a-token')).status).toBe(404);
    expect((await req('GET', `/cq/${token()}/state`)).status).toBe(404);
  });

  test('/cr held, after the tap: the block says making (the tap is the page\'s before the job runs)', async () => {
    seed();
    const { token, req } = await start();
    await req('POST', `/cq/${token()}/make`, { body: { surface: 'cr' } });
    const r = await req('GET', `/cr/${token()}`);
    expect(r.body).toContain('Making your quiz');
    expect(jobs('quiz_offer')[0][2].surface).toBe('cr');
  });
});
