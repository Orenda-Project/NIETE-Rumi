'use strict';
/**
 * The maker cta's refused-send fallback (§10.2) and its three buttons (§10.3).
 *
 * A refused cta_url → ONE reply-buttons message on the same inbound, the same ONE ledger row (not two). The body
 * follows who the phone is; every button title fits Meta's 20-code-point cap; each button id calls today's entry for
 * it, once. Only Supabase (the sister's in-memory fake) and the WhatsApp send are faked.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true),
  sendInteractiveMessage: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true),
  sendCtaUrl: jest.fn(async () => true),
  sendFlow: jest.fn(async () => true),
  sendVideo: jest.fn(async () => true),
  sendTemplate: jest.fn(async () => true),
}));

const { TEACHER, PHONE, seedMaker } = require('./maker-fixture');

const SAVED = { ...process.env };
const cp = (s) => [...String(s)].length;
const UNDO = { en: 'Not a teacher? Send “child”.', ur: 'ٹیچر نہیں ہیں؟ ”بچہ“ لکھ کر بھیجیں۔' };
const PICK = { en: 'Pick one:', ur: 'ایک چنیں:' };
const PICK_START = { en: 'Pick one to start:', ur: 'شروع کرنے کے لیے ایک چنیں:' };

let supabase; let WA; let fake; let F;
function load({ on = true } = {}) {
  jest.resetModules();
  supabase = require('../../shared/config/supabase');
  WA = require('../../shared/services/whatsapp.service');
  Object.values(WA).forEach((fn) => fn.mockClear && fn.mockClear());
  fake = seedMaker(supabase, { on });
  F = require('../../shared/services/first-touch/maker.fallback');
}

beforeEach(() => {
  process.env = {
    ...SAVED, WEB_QUIZ_TOKEN_SECRET: 'maker-test-secret', WEB_QUIZ_BASE_URL: 'https://quiz.example',
    STUDENT_VIDEOS_FLOW_ID: 'flow-videos', PAKISTAN_LP_FLOW_ID: 'flow-lp',
    OPENROUTER_API_KEY: 'unused-in-tests',   // menu.service builds its LLM client at require; nothing calls it here
  };
  delete process.env.REDIS_URL;
});
afterAll(() => { process.env = SAVED; });

/**
 * `maker_reply` joins the ledger's closed trigger list in the door's PR. Until then record() refuses it, so here (and
 * only for that one trigger while it is absent) the call answers yes; once the trigger is in the list this passes
 * straight through to the real ledger. → the spy.
 */
function ledgerKnowsMakerReply() {
  const Ledger = require('../../shared/services/quiz/message-ledger');
  const real = Ledger.record;
  return jest.spyOn(Ledger, 'record').mockImplementation((a) => (
    a && a.trigger === 'maker_reply' && !Ledger.TRIGGERS.includes('maker_reply') ? Promise.resolve(true) : real.call(Ledger, a)));
}

describe('a refused cta_url → the fallback, one counted reply', () => {
  // The empty line is the only path where makerCta sends this fallback itself; on door and menu paths the door does.
  test.each([['known', 'en'], ['known', 'ur']])('the empty line, who %s, lang %s: ONE button message, ledger recorded once', async (who, lang) => {
    load();
    const record = ledgerKnowsMakerReply();
    WA.sendCtaUrl.mockResolvedValueOnce(false);
    const { makerCta } = require('../../shared/services/first-touch/maker.cta');
    const res = await makerCta({ uid: TEACHER.id, lang, who, via: 'empty', phone: PHONE });
    expect(res).toEqual(expect.objectContaining({ sent: true, fallback: true }));
    expect(WA.sendCtaUrl).toHaveBeenCalledTimes(1);
    expect(WA.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    expect(WA.sendInteractiveButtons.mock.calls[0][1]).toEqual(F.fallbackMessage({ lang, who }));
    expect(WA.sendMessage).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'maker_reply' }));
    // the ledger first: its row is written before either send is attempted
    expect(record.mock.invocationCallOrder[0]).toBeLessThan(WA.sendCtaUrl.mock.invocationCallOrder[0]);
    expect(record.mock.invocationCallOrder[0]).toBeLessThan(WA.sendInteractiveButtons.mock.invocationCallOrder[0]);
  });

  test.each([['door', 'ur'], ['unknown', 'bi']])('sendFallback, who %s, lang %s: ONE button message with that body', async (who, lang) => {
    load();
    await expect(F.sendFallback({ phone: PHONE, lang, who })).resolves.toBe(true);
    expect(WA.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    expect(WA.sendInteractiveButtons.mock.calls[0][1]).toEqual(F.fallbackMessage({ lang, who }));
  });

  test('sendFallback alone writes no ledger row', async () => {
    load();
    const Ledger = require('../../shared/services/quiz/message-ledger');
    const record = jest.spyOn(Ledger, 'record');
    await expect(F.sendFallback({ phone: PHONE, lang: 'en', who: 'known' })).resolves.toBe(true);
    expect(record).not.toHaveBeenCalled();
    expect(fake.db.message_ledger).toEqual([]);
  });
});

describe('the bodies (COPY v1.2 M4 fallback)', () => {
  beforeAll(() => load());
  const lines = (b) => b.split('\n');

  test.each([['en'], ['ur']])('unknown (%s): the undo line ABOVE the start prompt, which is last', (lang) => {
    const { body } = F.fallbackMessage({ lang, who: 'unknown' });
    expect(lines(body)).toEqual([UNDO[lang], '', PICK_START[lang]]);
  });

  test('unknown (bi): the Urdu block, a blank line, the English block — each with its undo line above its prompt', () => {
    const { body } = F.fallbackMessage({ lang: 'bi', who: 'unknown' });
    expect(lines(body)).toEqual([UNDO.ur, '', PICK_START.ur, '', UNDO.en, '', PICK_START.en]);
  });

  test.each([['en', 'No lesson recorded yet.'], ['ur', 'ابھی تک کوئی سبق ریکارڈ نہیں ہوا۔']])('door (%s): context, the undo line, then "Pick one:" last', (lang, ctx) => {
    const { body } = F.fallbackMessage({ lang, who: 'door' });
    expect(lines(body)).toEqual([ctx, UNDO[lang], '', PICK[lang]]);
  });

  test('door (bi): the copy has no .bi of maker.fallback.body → .unknown.bi (the undo line kept)', () => {
    expect(F.fallbackMessage({ lang: 'bi', who: 'door' }).body).toBe(F.fallbackMessage({ lang: 'bi', who: 'unknown' }).body);
  });

  test.each([['en', 'No lesson recorded yet. Pick one:'], ['ur', 'ابھی تک کوئی سبق ریکارڈ نہیں ہوا۔ ایک چنیں:']])('known (%s): no undo line', (lang, want) => {
    const { body } = F.fallbackMessage({ lang, who: 'known' });
    expect(body).toBe(want);
    expect(body).not.toMatch(/child|بچہ/);
  });

  test('the buttons: ids ft_fb_quiz / ft_fb_lp / ft_fb_coach in order, every title ≤ 20 code points', () => {
    for (const who of ['known', 'door', 'unknown']) {
      for (const lang of ['en', 'ur', 'bi']) {
        const { buttons } = F.fallbackMessage({ lang, who });
        expect(buttons.map((b) => b.id)).toEqual(['ft_fb_quiz', 'ft_fb_lp', 'ft_fb_coach']);
        buttons.forEach((b) => { expect(b.title).toBeTruthy(); expect(cp(b.title)).toBeLessThanOrEqual(20); });
      }
    }
    expect(F.fallbackMessage({ lang: 'bi', who: 'unknown' }).buttons.map((b) => b.title))
      .toEqual(['Quiz · تیار کوئز', 'Plan · لیسن پلان', 'Record · ریکارڈ کریں']);
    expect(F.fallbackMessage({ lang: 'en', who: 'known' }).buttons.map((b) => b.title)).toEqual(['Ready quiz', 'Lesson plan', 'Record a lesson']);
  });
});

describe('a tap on a fallback button → today\'s entry, once', () => {
  const tap = (id, on = true) => { load({ on }); return { id, user: { ...TEACHER } }; };

  test('ft_fb_quiz → the student video library Flow', async () => {
    const t = tap('ft_fb_quiz');
    const Videos = require('../../shared/services/student-videos-entry.service');
    const spy = jest.spyOn(Videos, 'openStudentVideosFlow');
    await expect(F.handleFallbackButton({ user: t.user, phone: PHONE, id: t.id, lang: 'en' })).resolves.toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ from: PHONE, userId: TEACHER.id, language: 'en' }));
  });

  test('ft_fb_lp → the lesson-plan catalogue Flow', async () => {
    const t = tap('ft_fb_lp');
    const Lp = require('../../shared/services/lp-browse-entry.service');
    const spy = jest.spyOn(Lp, 'openLpBrowseFlow');
    await expect(F.handleFallbackButton({ user: t.user, phone: PHONE, id: t.id, lang: 'ur' })).resolves.toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ from: PHONE, userId: TEACHER.id, language: 'ur' }));
  });

  test('ft_fb_coach → the record-a-lesson prompt', async () => {
    const t = tap('ft_fb_coach');
    const MenuService = require('../../shared/services/menu.service');
    const spy = jest.spyOn(MenuService, '_handleClassroomCoachingChoice');
    await expect(F.handleFallbackButton({ user: t.user, phone: PHONE, id: t.id, lang: 'en' })).resolves.toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(TEACHER.id, expect.anything(), PHONE, 'en');
  });

  test('an id that is not ours → false, nothing called', async () => {
    const t = tap('ft_fb_other');
    const Videos = require('../../shared/services/student-videos-entry.service');
    const spy = jest.spyOn(Videos, 'openStudentVideosFlow');
    await expect(F.handleFallbackButton({ user: t.user, phone: PHONE, id: 'ft_fb_other', lang: 'en' })).resolves.toBe(false);
    await expect(F.handleFallbackButton({ user: t.user, phone: PHONE, id: 'tq_pick_x', lang: 'en' })).resolves.toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  test('the switch off → false (today\'s chain), no entry called', async () => {
    const t = tap('ft_fb_quiz', false);
    const Videos = require('../../shared/services/student-videos-entry.service');
    const spy = jest.spyOn(Videos, 'openStudentVideosFlow');
    await expect(F.handleFallbackButton({ user: t.user, phone: PHONE, id: t.id, lang: 'en' })).resolves.toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
