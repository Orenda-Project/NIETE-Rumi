'use strict';
/**
 * The one-tap line on the WhatsApp messages the teacher ALREADY gets (no new message, no new cost), behind
 * app_settings `quiz_forward_button` (JSON true only):
 *   the hand-out's PDF caption (transcript-quiz-handoff sendHandoff), the library share's "forward THIS one" line
 *   (video-quiz-share sendClassLink), and the six-hour "nobody has started" message (transcript-quiz-nudge).
 * Off (absent, false, "true", a failed read): every message is today's, byte for byte.
 * Only the network boundary is stood in for: Supabase, Redis, WhatsApp, R2, the loggers.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
process.env.PORTAL_URL = 'https://portal.example';
process.env.WHATSAPP_BOT_NUMBER = '15550001111';
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({ get: jest.fn(), set: jest.fn(), delete: jest.fn(), setNX: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/storage/r2', () => ({ downloadFromR2: jest.fn(async () => Buffer.from('%PDF-1.4 fake')), uploadBuffer: jest.fn() }));
// the diagram engine's molecule type (a third-party ESM build) is not under test here
jest.mock('openchemlib', () => require('../../../tests/__mocks__/openchemlib.js'));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const WebQuizToken = require('../../shared/services/quiz/web-quiz-token');
const Handoff = require('../../shared/services/quiz/transcript-quiz-handoff.service');

const PHONE = '923000000111';
const TEACHER = '00000000-0000-4000-8000-0000000000aa';
const QUIZ = '00000000-0000-4000-8000-0000000000bb';
const CODE_ID = '00000000-0000-4000-8000-0000000000cc';
const FWD_RX = /https:\/\/portal\.example\/quiz\/teacher\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22})\/fwd/;

let settings;
let db;
function fakeFrom(table) {
  const q = { table, filters: [], op: 'select', payload: null };
  const one = () => {
    if (q.op === 'insert') { db.inserts.push({ table, payload: q.payload }); return { data: { id: CODE_ID, code: q.payload && q.payload.code }, error: null }; }
    if (table === 'quizzes') return { data: db.quiz, error: null };
    if (table === 'users') return { data: db.user, error: null };
    return { data: null, error: null };
  };
  const api = {
    select() { return api; }, insert(p) { q.op = 'insert'; q.payload = p; return api; }, update(p) { q.op = 'update'; q.payload = p; return api; },
    eq(c, v) { q.filters.push([c, v]); return api; }, in(c, v) { q.filters.push([c, v]); return api; },
    gte() { return api; }, lte() { return api; }, lt() { return api; }, gt() { return api; }, is() { return api; }, not() { return api; },
    order() { return api; }, limit() { return api; },
    maybeSingle: async () => one(), single: async () => one(),
    then(res, rej) {
      if (table === 'app_settings') {
        const keys = q.filters.flatMap(([, v]) => (Array.isArray(v) ? v : [v]));
        return Promise.resolve({ data: settings.filter((r) => keys.includes(r.key)), error: null }).then(res, rej);
      }
      if (q.op !== 'select') { db.updates.push({ table, payload: q.payload }); return Promise.resolve({ data: null, error: null }).then(res, rej); }
      return Promise.resolve({ data: [], error: null }).then(res, rej);
    },
  };
  return api;
}

function bundle(teacherLang = 'en') {
  return {
    quiz: { id: QUIZ, teacher_id: TEACHER, topic: 'Fractions', quiz_source: 'lp_v8', grade: 4, meta: {} },
    session: { created_at: '2026-11-20T08:00:00Z' }, questions: null, qRows: [{ external_id: 'q1' }, { external_id: 'q2' }],
    digest: { topic: 'Fractions' }, language: 'en', teacherLang, teacherName: 'Teacher Testwala',
    meta: { share_code: 'ABCDEF', share_code_id: CODE_ID, link: 'https://portal.example/q/ABCDEF', student_message: 'Class, play: https://portal.example/q/ABCDEF', pdf_key: 'k.pdf' },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  settings = [];
  db = { quiz: null, user: null, inserts: [], updates: [] };
  supabase.from.mockImplementation(fakeFrom);
  try { require('../../shared/services/first-touch/quiz-forward')._resetCache(); } catch (_) { /* red run: not there yet */ }
  Handoff.sleep = async () => {};
});

const caption = () => WhatsAppService.sendDocument.mock.calls[0][3];

describe('the hand-out PDF caption', () => {
  test('switch ON → the caption ends with the one-tap line; its link is a qf token for THIS quiz, surface h, the teacher\'s language', async () => {
    settings = [{ key: 'quiz_forward_button', value: true }];
    const out = await Handoff.sendHandoff(QUIZ, PHONE, { prepared: bundle('en') });
    expect(out.ok).toBe(true);
    const cap = caption();
    expect(cap).toMatch(/Send it to your class group in one tap/);
    const m = FWD_RX.exec(cap);
    expect(m).not.toBeNull();
    const p = WebQuizToken.verify(m[1], 'qf');
    expect(p).toMatchObject({ s: 'h', l: 'en', q: Buffer.from(QUIZ.replace(/-/g, ''), 'hex').toString('base64url') });
    // the class's message is still the LAST bubble, alone and unchanged
    const last = WhatsAppService.sendMessage.mock.calls[WhatsAppService.sendMessage.mock.calls.length - 1];
    expect(last[1]).toBe('Class, play: https://portal.example/q/ABCDEF');
    expect([...cap].length).toBeLessThanOrEqual(1024);
  });

  test('Urdu teacher → the Urdu line (RLM-led, Nastaliq words, Latin terms of record kept)', async () => {
    settings = [{ key: 'quiz_forward_button', value: true }];
    await Handoff.sendHandoff(QUIZ, PHONE, { prepared: bundle('ur') });
    expect(caption()).toMatch(/ایک tap میں class group/);
    expect(WebQuizToken.verify(FWD_RX.exec(caption())[1], 'qf')).toMatchObject({ l: 'ur' });
  });

  test.each([['absent', []], ['false', [{ key: 'quiz_forward_button', value: false }]], ['"true"', [{ key: 'quiz_forward_button', value: 'true' }]]])(
    'switch %s → today\'s caption, no link', async (_, s) => {
      settings = s;
      await Handoff.sendHandoff(QUIZ, PHONE, { prepared: bundle('en') });
      expect(caption()).not.toMatch(/\/fwd|one tap/);
    },
  );

  test('the PDF cannot be sent → the text that stands in for it carries the line too', async () => {
    settings = [{ key: 'quiz_forward_button', value: true }];
    WhatsAppService.sendDocument.mockResolvedValueOnce(false);
    await Handoff.sendHandoff(QUIZ, PHONE, { prepared: bundle('en') });
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(FWD_RX);
  });
});

describe('the six-hour nudge', () => {
  const Nudge = require('../../shared/services/quiz/transcript-quiz-nudge.service');
  function quiet(lang = 'en') {
    db.quiz = { id: QUIZ, teacher_id: TEACHER, topic: 'Fractions', status: 'sent', language: 'en', meta: { sent_at: new Date(Date.now() - 7 * 3600e3).toISOString() } };
    db.user = { phone_number: PHONE, preferred_language: lang };
  }
  test('one quiet quiz, switch ON → today\'s words, then the one-tap line for that quiz (surface n)', async () => {
    settings = [{ key: 'quiz_forward_button', value: true }];
    quiet();
    const out = await Nudge.process(QUIZ);
    expect(out.ok).toBe(true);
    const body = WhatsAppService.sendMessage.mock.calls[0][1];
    expect(body.startsWith('No one has started your quiz on')).toBe(true);
    expect(WebQuizToken.verify(FWD_RX.exec(body)[1], 'qf')).toMatchObject({ s: 'n', l: 'en', q: Buffer.from(QUIZ.replace(/-/g, ''), 'hex').toString('base64url') });
  });
  test('switch OFF → today\'s message, no link', async () => {
    quiet();
    await Nudge.process(QUIZ);
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).not.toMatch(/\/fwd|one tap/);
  });
});

describe('the library share hand-out', () => {
  const Share = require('../../shared/services/quiz/video-quiz-share.service');
  const CTX = { quizId: QUIZ, videoId: null, userId: TEACHER, language: 'en' };
  test('switch ON → the "forward THIS one" message carries the one-tap line for the minted code (surface h); the class message stays last and unchanged', async () => {
    settings = [{ key: 'quiz_forward_button', value: true }];
    db.quiz = { id: QUIZ, topic: 'Fractions' };
    db.user = { name: 'Teacher Testwala', first_name: 'Teacher' };
    const minted = await Share.sendClassLink(CTX, PHONE);
    expect(minted).toMatchObject({ id: CODE_ID });
    const [first, last] = [WhatsAppService.sendMessage.mock.calls[0][1], WhatsAppService.sendMessage.mock.calls[1][1]];
    expect(WebQuizToken.verify(FWD_RX.exec(first)[1], 'qf')).toMatchObject({ s: 'h', c: Buffer.from(CODE_ID.replace(/-/g, ''), 'hex').toString('base64url') });
    expect(last).not.toMatch(/\/fwd/);
  });
  test('switch OFF → today\'s two messages', async () => {
    db.quiz = { id: QUIZ, topic: 'Fractions' };
    db.user = { name: 'Teacher Testwala', first_name: 'Teacher' };
    await Share.sendClassLink(CTX, PHONE);
    expect(WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n')).not.toMatch(/\/fwd|one tap/);
  });
});
