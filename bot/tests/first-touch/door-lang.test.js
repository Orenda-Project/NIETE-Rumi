'use strict';
/**
 * DOOR.md §7 / COPY §0 "Script rule per reply". Reply 1 follows the typed script: «کوئز» → door.body.ur with
 * the Urdu buttons; "quiz" and "/quiz" → door.body.bi with the bilingual buttons. A tap has no typed body, so the reply
 * after it is BILINGUAL: the maker reply with lang 'bi', the family reply with family.body.bi and its bilingual button.
 * 3 scripts × 2 taps = 6 cells: the string sent, the button ids, every button ≤ 20 code points, and the users row's
 * preferred_language byte-identical after every cell. users.preferred_language DEFAULTS to 'en' on every new row, so
 * 'en' is not a choice the person made: only 'ur' is honoured, and only for /quiz (the menu row is the menu-row PR's).
 */
process.env.STUDENT_MODE_ENABLED = 'true';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));
jest.mock('../../shared/database/bot-helpers', () => ({ getOrCreateSession: jest.fn(async () => 'sess-1'), storeConversation: jest.fn(async () => true) }));
jest.mock('../../shared/services/quiz/quiz-session.service', () => ({ getActiveState: jest.fn(async () => null), getPostQuizState: jest.fn(async () => null) }));
jest.mock('../../shared/services/quiz/student-quiz.service', () => ({ open: jest.fn(async () => true), handleButton: jest.fn(async () => true), RETRY_ID: 'sq_retry', CARD_ID: 'sq_card' }));
jest.mock('../../shared/handlers/text-message.handler', () => ({ handleGeneralConversation: jest.fn(), tryChildVideoMenu: jest.fn(async () => true) }));

const { UX_STRINGS: UX } = require('../../shared/config/ux-strings');
const Reply = require('../../shared/services/first-touch/door.reply');
const Door = require('../../shared/services/first-touch/door.service');
const T = require('./_door-turn');
const { UNKNOWN_USER } = require('./door-fixture');

const SAVED = { ...process.env };
let makerCta;
beforeEach(() => {
  process.env = { ...SAVED, ...T.ENV };
  jest.clearAllMocks();
  makerCta = jest.fn(async () => ({ sent: true }));
  Reply._deps.makerCta = makerCta;
});
afterEach(() => { Reply._deps.makerCta = undefined; });
afterAll(() => { process.env = SAVED; });

const cp = (s) => [...s].length;
const CHOOSER = {
  arabic: { body: UX.ftDoorBody.ur, titles: [UX.ftDoorBtnTeacher.ur, UX.ftDoorBtnChild.ur], lang: 'ur' },
  latin: { body: UX.ftDoorBodyBi.ur, titles: [Reply.BI_BUTTONS.doorTeacher, Reply.BI_BUTTONS.doorChild], lang: 'bi' },
};

describe.each([['کوئز', 'arabic'], ['quiz', 'latin'], ['/quiz', 'latin']])('"%s" (%s)', (body, script) => {
  test.each([['ft_door_teacher', 'teacher'], ['ft_door_child', 'child']])('then the %s tap', async (id, side) => {
    T.seed();
    const prefBefore = JSON.stringify(T.state.fake.db.users.map((u) => u.preferred_language));
    await T.text(body);
    const [chooser] = T.sent().buttons;
    expect(T.sent().buttons).toHaveLength(1);
    expect(chooser.body).toBe(CHOOSER[script].body);
    expect(chooser.buttons.map((b) => b.id)).toEqual(['ft_door_teacher', 'ft_door_child']);
    expect(chooser.buttons.map((b) => b.title)).toEqual(CHOOSER[script].titles);
    for (const b of chooser.buttons) expect(cp(b.title)).toBeLessThanOrEqual(20);
    expect(T.doorEvents()[0]).toEqual(expect.objectContaining({ door: 'text', reply: 'chooser', lang: CHOOSER[script].lang, script, tap: 'none' }));

    jest.clearAllMocks();
    await T.tap(id);
    if (side === 'teacher') {
      expect(makerCta).toHaveBeenCalledWith(expect.objectContaining({ uid: UNKNOWN_USER.id, lang: 'bi', who: 'unknown', via: 'door' }));
    } else {
      const [cta] = T.sent().cta;
      expect(cta.body).toBe(UX.ftFamilyBodyBi.ur);
      expect(cta.buttonText).toBe(Reply.BI_BUTTONS.family);
      expect(cp(cta.buttonText)).toBeLessThanOrEqual(20);
    }
    expect(T.doorEvents()).toEqual([expect.objectContaining({ door: 'text', tap: side, lang: 'bi', script: 'none' })]);
    expect(JSON.stringify(T.state.fake.db.users.map((u) => u.preferred_language))).toBe(prefBefore);
  });
});

test('the maker reply\'s 3-button fallback after a bilingual tap is bilingual: .unknown.bi + the .bi buttons, each ≤ 20 cp', async () => {
  Reply._deps.makerCta = jest.fn(() => { throw new Error('the maker cta is not here'); });
  T.seed();
  await T.tap('ft_door_teacher');
  const [fb] = T.sent().buttons;
  expect(fb.body).toBe(UX.ftMakerFallbackBodyUnknownBi.ur);
  expect(fb.buttons.map((b) => b.id)).toEqual(['ft_mk_ready', 'ft_mk_plan', 'ft_mk_record']);
  expect(fb.buttons.map((b) => b.title)).toEqual([Reply.BI_BUTTONS.fallback1, Reply.BI_BUTTONS.fallback2, Reply.BI_BUTTONS.fallback3]);
  for (const b of fb.buttons) expect(cp(b.title)).toBeLessThanOrEqual(20);
});

test('/quiz from a row whose preferred_language is ur (set by the person) → the Urdu chooser; never written', async () => {
  T.seed();
  T.state.fake.db.users[0].preferred_language = 'ur';
  await T.text('/quiz', { ...UNKNOWN_USER, preferred_language: 'ur' });
  expect(T.sent().buttons[0].body).toBe(UX.ftDoorBody.ur);
  expect(T.state.fake.db.users[0].preferred_language).toBe('ur');
});

test('the row\'s default preferred_language "en" is NOT a choice: never door.body.en', async () => {
  T.seed();
  await T.text('/quiz', { ...UNKNOWN_USER, preferred_language: 'en' });
  expect(T.sent().buttons[0].body).toBe(UX.ftDoorBodyBi.ur);
  expect(T.sent().buttons[0].body).not.toBe(UX.ftDoorBody.en);
});

test('langFor / scriptOf, the pure rule', () => {
  expect(Door.scriptOf('کوئز')).toBe('arabic');
  expect(Door.scriptOf('«کوئز» please')).toBe('arabic');
  expect(Door.scriptOf('quiz کوئز')).toBe('latin');
  expect(Door.scriptOf('/quiz')).toBe('latin');
  expect(Door.scriptOf('')).toBe('none');
  expect(Door.scriptOf('📝')).toBe('none');
  expect(Door.langFor({ body: 'کوئز', user: {} })).toBe('ur');
  expect(Door.langFor({ body: 'quiz', user: { preferred_language: 'ur' } })).toBe('bi');
  expect(Door.langFor({ body: '/quiz', user: { preferred_language: 'ur' } })).toBe('ur');
  expect(Door.langFor({ body: '/quiz', user: { preferred_language: 'en' } })).toBe('bi');
  expect(Door.langFor({ body: 'quiz', user: {}, afterTap: true })).toBe('bi');
  expect(Door.langFor({ body: undefined, user: {} })).toBe('bi');
});
