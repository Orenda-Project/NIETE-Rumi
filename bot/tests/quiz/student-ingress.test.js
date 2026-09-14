'use strict';
/**
 * bd-2yyry.1 / .2 / .3 — who is holding the handset, decided at the door.
 *
 * classify() is asserted against the three rules on the live data's shape
 * (users.role defaults to 'teacher'; identity lives in name / teacher_uuid /
 * school_id / portal_activated; activity is a head count). route() is
 * EXECUTED with a child user for every message type the operator named —
 * voice, image, teacher buttons, /menu, /quiz, a school question — and with a
 * teacher user for the same, where it must be a no-op.
 */
process.env.STUDENT_MODE_ENABLED = 'true';

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/database/bot-helpers', () => ({
  getOrCreateSession: jest.fn().mockResolvedValue('sess-1'),
  storeConversation: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/quiz/quiz-session.service', () => ({
  getActiveState: jest.fn().mockResolvedValue(null),
  getPostQuizState: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../shared/handlers/text-message.handler', () => ({
  handleGeneralConversation: jest.fn().mockResolvedValue(undefined),
  tryChildVideoMenu: jest.fn().mockResolvedValue(true),
}));

const supabase = require('../../shared/config/supabase');
const redisService = require('../../shared/services/cache/railway-redis.service');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const TextHandler = require('../../shared/handlers/text-message.handler');
const QuizSession = require('../../shared/services/quiz/quiz-session.service');
const { resolveUx } = require('../../shared/config/ux-strings');
const Ingress = require('../../shared/services/student-ingress');

const PHONE = '923001234567';

/** Table-driven supabase: head counts per table, students rows, sessions. */
function stub({ counts = {}, students = [], sessions = [], usersRow = null, failTable = null } = {}) {
  supabase.from.mockImplementation((table) => {
    const chain = {
      select: (cols, opts) => { chain._head = Boolean(opts && opts.head); return chain; },
      eq: () => chain, is: () => chain, in: () => chain, or: () => chain,
      order: () => chain, limit: () => chain, not: () => chain,
      maybeSingle: async () => ({ data: table === 'users' ? usersRow : (table === 'quizzes' ? { language: 'ur' } : null), error: null }),
      then: (resolve) => {
        if (table === failTable) return resolve({ count: null, data: null, error: { message: 'boom' } });
        if (chain._head) return resolve({ count: counts[table] || 0, error: null });
        if (table === 'students') return resolve({ data: students, error: null });
        if (table === 'quiz_sessions') return resolve({ data: sessions, error: null });
        return resolve({ data: [], error: null });
      },
    };
    return chain;
  });
}

const FULL = { id: 'u1', registration_completed: false, registration_state: 'unregistered', name: null,
  teacher_uuid: null, school_id: null, portal_activated: false, role: 'teacher' };
const CHILD_ROW = [{ id: 'st-1', student_name: 'Ayesha', self_reported_class: '4', is_active: true }];
const CHILD_SESSION = [{ id: 's1', created_at: '2026-09-10T08:00:00Z', quiz_id: 'q1', student_class: '4' }];

beforeEach(() => {
  jest.clearAllMocks();
  redisService.get.mockResolvedValue(null);
  QuizSession.getActiveState.mockResolvedValue(null);
  QuizSession.getPostQuizState.mockResolvedValue(null);
});

describe('classify — the three rules', () => {
  test('bare role=teacher is NOT identity: with no activity and no quiz row the handset is UNKNOWN (registration still works)', async () => {
    stub({ counts: {}, students: [] });
    const v = await Ingress.classify({ user: FULL, phone: PHONE });
    expect(v).toMatchObject({ persona: null, mode: 'unknown', reason: 'no_student_row' });
  });

  test.each([
    ['registration_completed', { registration_completed: true }],
    ['a name', { name: 'Ayesha Khan' }],
    ['teacher_uuid (roster)', { teacher_uuid: 'T-1' }],
    ['school_id (roster)', { school_id: 'S-1' }],
    ['portal_activated', { portal_activated: true }],
    ['role coach', { role: 'coach' }],
    ['role principal', { role: 'principal' }],
  ])('identity by %s → teacher, even with a quiz-joined row on the handset', async (_, extra) => {
    stub({ students: CHILD_ROW, sessions: CHILD_SESSION });
    const v = await Ingress.classify({ user: { ...FULL, ...extra }, phone: PHONE });
    expect(v).toMatchObject({ persona: null, mode: 'teacher', reason: 'identity' });
    expect(supabase.from).not.toHaveBeenCalledWith('quizzes');     // no activity read for an identified adult
  });

  test.each([
    ['owns a quiz', { quizzes: 1 }],
    ['a coaching session', { coaching_sessions: 1 }],
    ['a real lesson plan', { lesson_plans: 1 }],
    ['a roster list', { student_lists: 1 }],
    ['a training attempt', { training_assessment_attempts: 1 }],
    ['an assessment request', { assessment_requests: 1 }],
  ])('no identity but activity (%s) → teacher, even with a quiz-joined row', async (_, counts) => {
    stub({ counts, students: CHILD_ROW, sessions: CHILD_SESSION });
    const v = await Ingress.classify({ user: FULL, phone: PHONE });
    expect(v).toMatchObject({ mode: 'teacher', reason: 'activity' });
  });

  test('no identity, no activity, a quiz-joined row → STUDENT, in the quiz language and class', async () => {
    stub({ students: CHILD_ROW, sessions: CHILD_SESSION });
    const v = await Ingress.classify({ user: FULL, phone: PHONE });
    expect(v).toMatchObject({ persona: 'student', mode: 'student', language: 'ur', studentClass: '4' });
    expect(redisService.set).toHaveBeenCalledWith(Ingress.CACHE_KEY(PHONE), expect.objectContaining({ mode: 'student' }), Ingress.CACHE_TTL_SECS);
  });

  test('no recency window: a quiz row from months ago is still a student', async () => {
    stub({ students: CHILD_ROW, sessions: [{ ...CHILD_SESSION[0], created_at: '2026-03-01T08:00:00Z' }] });
    expect((await Ingress.classify({ user: FULL, phone: PHONE })).mode).toBe('student');
  });

  test('an activity lookup failure is UNKNOWN (towards teacher) and is not cached', async () => {
    stub({ students: CHILD_ROW, sessions: CHILD_SESSION, failTable: 'coaching_sessions' });
    const v = await Ingress.classify({ user: FULL, phone: PHONE });
    expect(v).toMatchObject({ mode: 'unknown', reason: 'lookup_failed' });
    expect(redisService.set).not.toHaveBeenCalled();
  });

  test('a users row missing the identity columns is completed from the database before deciding', async () => {
    stub({ students: CHILD_ROW, sessions: CHILD_SESSION, usersRow: { ...FULL, teacher_uuid: 'T-9' } });
    const v = await Ingress.classify({ user: { id: 'u1', phone_number: PHONE }, phone: PHONE });
    expect(v).toMatchObject({ mode: 'teacher', reason: 'identity' });
  });

  test('a cached verdict is returned without a read', async () => {
    redisService.get.mockResolvedValue({ persona: 'student', mode: 'student', reason: 'cached', language: 'en', studentClass: null });
    const v = await Ingress.classify({ user: FULL, phone: PHONE });
    expect(v.mode).toBe('student');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test('flag off: nothing is read, UNKNOWN', async () => {
    process.env.STUDENT_MODE_ENABLED = 'false';
    try {
      const v = await Ingress.classify({ user: FULL, phone: PHONE });
      expect(v).toMatchObject({ mode: 'unknown', reason: 'flag_off' });
      expect(supabase.from).not.toHaveBeenCalled();
    } finally { process.env.STUDENT_MODE_ENABLED = 'true'; }
  });
});

describe('route — a child', () => {
  // A fresh row per test: route() may clear persona on the escape hatch.
  let child;
  beforeEach(() => { child = { ...FULL, persona: 'student', personaLanguage: 'ur', personaClass: '4', preferred_language: 'en' }; });
  const msg = (type, extra = {}) => ({ id: 'wamid.1', type, ...extra });

  test('a voice note gets one typed line in the quiz language and nothing is transcribed', async () => {
    const handled = await Ingress.route({ message: msg('audio', { audio: { id: 'a1' } }), messageType: 'audio', from: PHONE, user: child });
    expect(handled).toBe(true);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, resolveUx('studentVoiceNotSupported', { language: 'ur' }));
  });

  test.each(['image', 'document', 'video'])('a %s gets one typed line', async (type) => {
    expect(await Ingress.route({ message: msg(type), messageType: type, from: PHONE, user: child })).toBe(true);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, resolveUx('studentMediaNotSupported', { language: 'ur' }));
  });

  test.each(['lessonplan_yes_1', 'coaching_confirm_1', 'observe_ok_1', 'training_module_done_1', 'lp_used_1', 'att_class_1', 'quiz_revise_next_1', 'show_feature_video_1'])(
    'a teacher button (%s) is refused with one line', async (id) => {
      const m = msg('interactive', { interactive: { type: 'button_reply', button_reply: { id } } });
      expect(await Ingress.route({ message: m, messageType: 'interactive', from: PHONE, user: child })).toBe(true);
      expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, resolveUx('studentTeacherOnly', { language: 'ur' }));
    });

  test.each(['vq_invite_yes', 'vq_more_no', 'student_video_feedback_yes_1'])('a child button (%s) passes through', async (id) => {
    const m = msg('interactive', { interactive: { type: 'button_reply', button_reply: { id } } });
    expect(await Ingress.route({ message: m, messageType: 'interactive', from: PHONE, user: child })).toBe(false);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });

  test('a Flow reply passes through (it answers something we sent)', async () => {
    const m = msg('interactive', { interactive: { type: 'nfm_reply', nfm_reply: { response_json: '{}' } } });
    expect(await Ingress.route({ message: m, messageType: 'interactive', from: PHONE, user: child })).toBe(false);
  });

  test.each(['/lesson', '/observe', '/training', '/register-me-not', '/attendance', '/portal'])('a teacher command (%s) is refused', async (cmd) => {
    expect(await Ingress.route({ message: msg('text'), messageType: 'text', messageBody: cmd, from: PHONE, user: child })).toBe(true);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, resolveUx('studentTeacherOnly', { language: 'ur' }));
  });

  test('/video passes through to the child videos path', async () => {
    expect(await Ingress.route({ message: msg('text'), messageType: 'text', messageBody: '/video', from: PHONE, user: child })).toBe(false);
  });

  test('/menu sends the two child buttons, Videos and Quizzes, ≤ 20 code points each', async () => {
    expect(await Ingress.route({ message: msg('text'), messageType: 'text', messageBody: '/menu', from: PHONE, user: child })).toBe(true);
    const [, opts] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(opts.buttons.map((b) => b.id)).toEqual([Ingress.CHILD_MENU_VIDEO, Ingress.CHILD_MENU_QUIZ]);
    for (const b of opts.buttons) expect(Array.from(b.title).length).toBeLessThanOrEqual(20);
  });

  test('the Videos menu button opens the child videos Flow', async () => {
    const m = msg('interactive', { interactive: { type: 'button_reply', button_reply: { id: Ingress.CHILD_MENU_VIDEO } } });
    expect(await Ingress.route({ message: m, messageType: 'interactive', from: PHONE, user: child })).toBe(true);
    expect(TextHandler.tryChildVideoMenu).toHaveBeenCalledWith(PHONE, 'ur');
  });

  test('a QUIZ code passes through to the join path', async () => {
    expect(await Ingress.route({ message: msg('text'), messageType: 'text', messageBody: 'QUIZ-K7RM2X', from: PHONE, user: child })).toBe(false);
  });

  test('a message while a quiz is in flight passes through (the quiz chain owns it)', async () => {
    QuizSession.getActiveState.mockResolvedValue({ sessionId: 's1' });
    expect(await Ingress.route({ message: msg('text'), messageType: 'text', messageBody: 'B', from: PHONE, user: child })).toBe(false);
  });

  test('a school question goes to the child tutor directly, with the quiz language, and is stored', async () => {
    const { storeConversation } = require('../../shared/database/bot-helpers');
    expect(await Ingress.route({ message: msg('text'), messageType: 'text', messageBody: 'what is a fraction?', from: PHONE, user: child })).toBe(true);
    expect(TextHandler.handleGeneralConversation).toHaveBeenCalledWith(PHONE, 'what is a fraction?', expect.objectContaining({ id: 'u1', persona: 'student' }), 'sess-1', 'ur', expect.any(Object));
    expect(storeConversation).toHaveBeenCalledWith('u1', 'user', 'what is a fraction?', 'text', 'sess-1');
  });

  test('"I am a teacher" retires the quiz rows, drops the cached verdict and falls through to the ordinary path', async () => {
    stub({});
    expect(await Ingress.route({ message: msg('text'), messageType: 'text', messageBody: 'I am a teacher', from: PHONE, user: { ...child } })).toBe(false);
    expect(redisService.delete).toHaveBeenCalledWith(Ingress.CACHE_KEY(PHONE));
  });

  test('"my teacher said" is NOT a claim: it is a school question', async () => {
    expect(await Ingress.route({ message: msg('text'), messageType: 'text', messageBody: 'my teacher said fractions are parts', from: PHONE, user: child })).toBe(true);
    expect(TextHandler.handleGeneralConversation).toHaveBeenCalled();
  });
});

describe('route — everyone else is untouched', () => {
  test.each([
    ['a teacher', { ...FULL, name: 'Ayesha Khan', persona: null }],
    ['an unknown handset', { ...FULL, persona: null }],
    ['a row never attached', { ...FULL }],
    ['no user', null],
  ])('%s: voice, image, buttons, commands and text all pass through', async (_, user) => {
    for (const [type, extra, body] of [
      ['audio', { audio: { id: 'a' } }, ''], ['image', {}, ''],
      ['interactive', { interactive: { type: 'button_reply', button_reply: { id: 'lessonplan_yes_1' } } }, ''],
      ['text', {}, '/menu'], ['text', {}, 'hello'],
    ]) {
      expect(await Ingress.route({ message: { id: 'w', type, ...extra }, messageType: type, messageBody: body, from: PHONE, user })).toBe(false);
    }
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });
});

describe('the door is wired', () => {
  test('whatsapp-bot.js attaches the verdict after the users row and routes before the type dispatch', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../../whatsapp-bot.js'), 'utf8');
    const attachAt = src.indexOf('StudentIngress.attach(user, from)');
    const routeAt = src.indexOf('StudentIngress.route({ message, messageType, messageBody, from, user })');
    const dispatchAt = src.indexOf("if (messageType === 'text' && messageBody) {");
    expect(attachAt).toBeGreaterThan(-1);
    expect(routeAt).toBeGreaterThan(attachAt);
    expect(dispatchAt).toBeGreaterThan(routeAt);
    // and the require the bot file makes resolves to this module
    const m = /require\('(\.\/shared\/services\/student-ingress)'\)/.exec(src);
    expect(m).toBeTruthy();
    expect(require(path.resolve(path.dirname(path.join(__dirname, '../../whatsapp-bot.js')), m[1]))).toBe(Ingress);
  });
});
