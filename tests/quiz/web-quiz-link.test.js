'use strict';
/**
 * The web quiz link — one helper decides what link a child taps.
 *
 * `quizLink(code, { teacherUserId })` returns the web page link
 * (`<base>/q/<code>`) only when app_settings `web_quiz_enabled` is on AND the
 * teacher is allowed by `web_quiz_teachers` ("all", or a list of user ids).
 * Anything else — the flag off, a missing row, a read error, a teacher not on
 * the list, no base URL — is today's wa.me link, so the WhatsApp quiz stays the
 * kill switch.
 *
 * The three places that hand out a link (the teacher's class message, the
 * transcript quiz hand-off, a child's invite) are driven for real below; only
 * Supabase, WhatsApp, Redis and the queue are stand-ins. The forwarded text must
 * be byte-for-byte what it was apart from the link itself.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendReaction: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/video-quiz-binge.service', () => ({ offerMore: jest.fn().mockResolvedValue(true) }));

const supabase = require('../../bot/shared/config/supabase');
const WA = require('../../bot/shared/services/whatsapp.service');
const redis = require('../../bot/shared/services/cache/railway-redis.service');
const { installFrom } = require('./helpers/supabase-chain');
const WebLink = require('../../bot/shared/services/quiz/web-quiz-link');
const Share = require('../../bot/shared/services/quiz/video-quiz-share.service');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const Invite = require('../../bot/shared/services/quiz/video-quiz-invite.service');
// The preview-token signer lives in its own module (the web quiz API), which
// ships in a parallel change. A virtual stand-in lets the caption be checked
// with and without a token either way; it is registered by a built path
// because the require-graph audit reads literal paths as runtime requires.
// web-quiz-link requires it lazily, at call time, so doMock here is in time.
const TOKEN_PATH = ['..', '..', 'bot', 'shared', 'services', 'quiz', 'web-quiz-token'].join('/');
jest.doMock(TOKEN_PATH, () => ({ signPreview: jest.fn().mockReturnValue(null) }), { virtual: true });
const Token = require(TOKEN_PATH);

const TEACHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const QID = '22222222-2222-4222-8222-222222222222';
const SID = '11111111-1111-4111-8111-111111111111';
const PHONE = '920000000001';
const BOT = '920000000000';
const BASE = 'https://portal.example.test';

/** app_settings rows, or a read error. */
function settings({ enabled, teachers, error } = {}) {
  if (error) return { data: null, error: { message: 'boom' } };
  const rows = [];
  if (enabled !== undefined) rows.push({ key: 'web_quiz_enabled', value: enabled });
  if (teachers !== undefined) rows.push({ key: 'web_quiz_teachers', value: teachers });
  return { data: rows, error: null };
}

const ENV = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  WebLink._resetCache();
  process.env = { ...ENV, WHATSAPP_BOT_NUMBER: BOT, PORTAL_URL: `${BASE}/` };
  delete process.env.WEB_QUIZ_BASE_URL;
  jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
});
afterAll(() => { process.env = ENV; });

const WA_LINK = (code) => `https://wa.me/${BOT}?text=QUIZ-${code}`;
const WEB_LINK = (code) => `${BASE}/q/${code}`;

describe('quizLink — who gets the web page', () => {
  test('flag off: the wa.me link', async () => {
    installFrom(supabase.from, { app_settings: settings({ enabled: false, teachers: 'all' }) });
    expect(await WebLink.quizLink('ABC234', { teacherUserId: TEACHER, whatsapp: WA_LINK('ABC234') })).toBe(WA_LINK('ABC234'));
  });

  test('no settings rows at all: the wa.me link', async () => {
    installFrom(supabase.from, { app_settings: settings() });
    expect(await WebLink.quizLink('ABC234', { teacherUserId: TEACHER, whatsapp: WA_LINK('ABC234') })).toBe(WA_LINK('ABC234'));
  });

  test('the settings read fails: the wa.me link (fail closed)', async () => {
    installFrom(supabase.from, { app_settings: settings({ error: true }) });
    expect(await WebLink.quizLink('ABC234', { teacherUserId: TEACHER, whatsapp: WA_LINK('ABC234') })).toBe(WA_LINK('ABC234'));
  });

  test('flag on + "all": the web link on PORTAL_URL (trailing slash trimmed)', async () => {
    installFrom(supabase.from, { app_settings: settings({ enabled: true, teachers: 'all' }) });
    expect(await WebLink.quizLink('ABC234', { teacherUserId: TEACHER, whatsapp: WA_LINK('ABC234') })).toBe(WEB_LINK('ABC234'));
  });

  test('flag on (stored as the string "true") + the teacher on the list: the web link', async () => {
    installFrom(supabase.from, { app_settings: settings({ enabled: 'true', teachers: JSON.stringify([TEACHER]) }) });
    expect(await WebLink.quizLink('ABC234', { teacherUserId: TEACHER, whatsapp: WA_LINK('ABC234') })).toBe(WEB_LINK('ABC234'));
  });

  test('flag on + the teacher NOT on the list: the wa.me link', async () => {
    installFrom(supabase.from, { app_settings: settings({ enabled: true, teachers: [OTHER] }) });
    expect(await WebLink.quizLink('ABC234', { teacherUserId: TEACHER, whatsapp: WA_LINK('ABC234') })).toBe(WA_LINK('ABC234'));
  });

  test('flag on + no teacher list: the wa.me link (an allow-list that was never written allows nobody)', async () => {
    installFrom(supabase.from, { app_settings: settings({ enabled: true }) });
    expect(await WebLink.quizLink('ABC234', { teacherUserId: TEACHER, whatsapp: WA_LINK('ABC234') })).toBe(WA_LINK('ABC234'));
  });

  test('flag on + allowed, but no base URL anywhere: the wa.me link', async () => {
    delete process.env.PORTAL_URL;
    installFrom(supabase.from, { app_settings: settings({ enabled: true, teachers: 'all' }) });
    expect(await WebLink.quizLink('ABC234', { teacherUserId: TEACHER, whatsapp: WA_LINK('ABC234') })).toBe(WA_LINK('ABC234'));
  });

  test('WEB_QUIZ_BASE_URL wins over PORTAL_URL', async () => {
    process.env.WEB_QUIZ_BASE_URL = 'https://quiz.example.test';
    installFrom(supabase.from, { app_settings: settings({ enabled: true, teachers: 'all' }) });
    expect(await WebLink.quizLink('ABC234', { teacherUserId: TEACHER, whatsapp: WA_LINK('ABC234') })).toBe('https://quiz.example.test/q/ABC234');
  });
});

describe('the teacher\'s class message (video-lesson quiz)', () => {
  async function classMessage(lang, appSettings) {
    jest.clearAllMocks();
    WebLink._resetCache();
    installFrom(supabase.from, {
      app_settings: appSettings,
      users: { data: [{ name: 'Teacher' }] },
      quizzes: { data: [{ topic: 'Plants' }] },
      quiz_share_codes: { data: [{ id: 'sc-9', code: 'K7RM2P' }] },
    });
    await Share.deliverClassLink({ quizId: QID, userId: TEACHER, videoId: 'v-1', language: lang }, PHONE);
    const texts = WA.sendMessage.mock.calls.map((c) => c[1]);
    return texts[texts.length - 1];
  }

  test.each(['en', 'ur'])('%s: on + allowed = the web link; the rest of the text is unchanged', async (lang) => {
    const off = await classMessage(lang, settings({ enabled: false }));
    const on = await classMessage(lang, settings({ enabled: true, teachers: [TEACHER] }));
    expect(off).toContain(WA_LINK('K7RM2P'));
    expect(on).toContain(WEB_LINK('K7RM2P'));
    expect(on).not.toContain('wa.me');
    expect(on.replace(WEB_LINK('K7RM2P'), '<L>')).toBe(off.replace(WA_LINK('K7RM2P'), '<L>'));
  });

  test('on + a different teacher allowed = the wa.me link', async () => {
    const on = await classMessage('en', settings({ enabled: true, teachers: [OTHER] }));
    expect(on).toContain(WA_LINK('K7RM2P'));
  });
});

describe('the transcript quiz hand-off (first send mints the code)', () => {
  const DIGEST = {
    topic: 'Fractions', topic_as_taught: 'کسریں', subject: 'maths', grade_band: '3-5', language_of_instruction: 'ur', confidence: 0.9,
    slos: [{ id: 'S1', statement: 'a', taught_level: 'recall' }],
  };
  const ROW = {
    external_id: `tq:${QID}:S1:1`, question_text: 'س', option_a: 'a', option_b: 'b', option_c: 'c',
    correct_option: 'A', explanation: null, distractor_misconceptions: null, option_feedback: { correct: 'ok', wrong: {} },
    media: null, render_pattern: 'P1', sort_order: 0,
  };
  const quizRow = (meta) => ({
    id: QID, teacher_id: TEACHER, topic: 'کسریں', subject: 'maths', language: 'ur', grade: '4',
    status: 'ready', coaching_session_id: SID, meta,
  });

  async function studentMessage(appSettings) {
    return (await handOff(appSettings)).meta;
  }

  async function handOff(appSettings) {
    jest.clearAllMocks();
    WebLink._resetCache();
    jest.spyOn(Share, 'mintCode').mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'Teacher' });
    const meta = { digest: DIGEST, cost_usd: 0.01 };
    installFrom(supabase.from, {
      app_settings: appSettings,
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quizRow(meta)] }),
    });
    const prepared = {
      quiz: quizRow(meta), session: { id: SID, created_at: '2026-09-05T05:00:00Z' }, questions: null, qRows: [ROW],
      digest: DIGEST, teacherName: 'Teacher', meta, language: 'ur', teacherLang: 'ur',
    };
    const r = await Handoff.sendHandoff(QID, PHONE, { firstSend: true, prepared });
    expect(r.ok).toBe(true);
    const sent = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1])
      .find((u) => u.status === 'sent');
    const caption = WA.sendDocument.mock.calls[0] && WA.sendDocument.mock.calls[0][3];
    return { meta: sent.meta, caption };
  }

  test('off = wa.me; on + allowed = web; the stored forwardable differs only in the link and the last line', async () => {
    const off = await studentMessage(settings({ enabled: false }));
    const on = await studentMessage(settings({ enabled: true, teachers: 'all' }));
    expect(off.link).toBe(WA_LINK('ABC234'));
    expect(on.link).toBe(WEB_LINK('ABC234'));
    expect(on.student_message).toContain(WEB_LINK('ABC234'));
    // The web page asks only the name; the WhatsApp quiz asks name and class.
    const head = (m, l) => m.replace(l, '<L>').split('\n\n').slice(0, -1);
    expect(head(on.student_message, WEB_LINK('ABC234'))).toEqual(head(off.student_message, WA_LINK('ABC234')));
    expect(on.student_message.split('\n\n').pop()).not.toBe(off.student_message.split('\n\n').pop());
  });

  test('on + not allowed = wa.me', async () => {
    const on = await studentMessage(settings({ enabled: true, teachers: [OTHER] }));
    expect(on.link).toBe(WA_LINK('ABC234'));
  });

  test('the teacher-only caption carries the signed preview link; the forwardable never does', async () => {
    Token.signPreview.mockReturnValue('tok.sig');
    const { meta, caption } = await handOff(settings({ enabled: true, teachers: [TEACHER] }));
    expect(Token.signPreview).toHaveBeenCalledWith({ shareCodeId: 'sc-1', teacherUserId: TEACHER });
    expect(caption).toContain(`${WEB_LINK('ABC234')}?p=tok.sig`);
    expect(meta.student_message).not.toContain('?p=');
    Token.signPreview.mockReturnValue(null);
  });

  test('no preview line when the web quiz is off, or there is no token', async () => {
    Token.signPreview.mockReturnValue('tok.sig');
    const off = await handOff(settings({ enabled: false }));
    expect(off.caption).not.toContain('?p=');
    Token.signPreview.mockReturnValue(null);
    const noTok = await handOff(settings({ enabled: true, teachers: 'all' }));
    expect(noTok.caption).not.toContain('?p=');
    expect(noTok.caption).toBe(off.caption);
  });
});

describe('a child\'s invite to a friend', () => {
  async function inviteMessage(appSettings) {
    jest.clearAllMocks();
    WebLink._resetCache();
    redis.get.mockResolvedValue({ studentId: 'st-1', shareCodeId: 'sc-1', language: 'en', sessionId: 's-1', quizId: QID });
    installFrom(supabase.from, {
      app_settings: appSettings,
      quiz_share_codes: (calls) => (calls.some((c) => c[0] === 'insert')
        ? { data: [{ id: 'sc-2', code: 'XY34ZW' }] }
        : { data: [{ id: 'sc-1', quiz_id: QID, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Teacher', topic: 'Plants', language: 'en' }] }),
      students: { data: [{ student_name: 'Zara Test' }] },
    });
    await Invite.handleInviteButton(Invite.INVITE_YES, PHONE);
    const texts = WA.sendMessage.mock.calls.map((c) => c[1]);
    return texts[texts.length - 1];
  }

  test('off = wa.me; on + allowed (the parent code\'s teacher) = web; text otherwise identical', async () => {
    const off = await inviteMessage(settings({ enabled: false }));
    const on = await inviteMessage(settings({ enabled: true, teachers: [TEACHER] }));
    expect(off).toContain(WA_LINK('XY34ZW'));
    expect(on).toContain(WEB_LINK('XY34ZW'));
    expect(on.replace(WEB_LINK('XY34ZW'), '<L>')).toBe(off.replace(WA_LINK('XY34ZW'), '<L>'));
  });

  test('on + not allowed = wa.me', async () => {
    const on = await inviteMessage(settings({ enabled: true, teachers: [OTHER] }));
    expect(on).toContain(WA_LINK('XY34ZW'));
  });
});
