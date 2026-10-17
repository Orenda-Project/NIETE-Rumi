'use strict';
/**
 * The empty /quiz line (first-touch maker, §9): a registered teacher with NO lesson gets the maker cta in place of
 * "No lessons yet…" when `quiz_maker_page` is on; everything else is byte-identical to today.
 *
 * showList() runs for real, with the empty-line branch inside it; only Supabase (the sister's in-memory fake, which
 * applies filters) and the WhatsApp send are faked. The ledger, the switch read, the token and the cta are real.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true),
  sendInteractiveMessage: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true),
  sendCtaUrl: jest.fn(async () => true),
  sendFlow: jest.fn(async () => true),
}));

const { TEACHER, PHONE, seedMaker } = require('./maker-fixture');

const LIST = '../../shared/services/quiz/transcript-quiz-list.service';
const EMPTY = '../../shared/services/first-touch/maker.empty';
const SAVED = { ...process.env };

let supabase; let WA; let events; let List; let fake;

/** A fresh module graph: the fake seeded, the event spy set BEFORE showList's module reads logEvent. */
function load({ on = true, settings = {}, extra = {}, before = null } = {}) {
  jest.resetModules();
  if (before) before();
  supabase = require('../../shared/config/supabase');
  WA = require('../../shared/services/whatsapp.service');
  Object.values(WA).forEach((fn) => fn.mockClear && fn.mockClear());
  const SL = require('../../shared/utils/structured-logger');
  events = jest.spyOn(SL, 'logEvent').mockImplementation(() => {});
  fake = seedMaker(supabase, { on, extra });
  const from = supabase.from;
  supabase.from = (t) => withRange(from(t));
  for (const [key, value] of Object.entries(settings)) fake.db.app_settings.push({ key, value });
  List = require(LIST);
}

/** The fake has no .range (the recorded-lesson read pages with it): limit to `to`, then drop the first `from` rows. */
function withRange(b) {
  b.range = (lo, hi) => {
    b.limit(hi + 1);
    const then = b.then;
    b.then = (res, rej) => then((out) => ({ ...out, data: Array.isArray(out && out.data) ? out.data.slice(lo) : out && out.data })).then(res, rej);
    return b;
  };
  return b;
}

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

const named = (name) => events.mock.calls.filter(([n]) => n === name).map(([, f]) => f);
const sends = () => ({
  text: WA.sendMessage.mock.calls, cta: WA.sendCtaUrl.mock.calls,
  buttons: WA.sendInteractiveButtons.mock.calls, list: WA.sendInteractiveMessage.mock.calls,
});
const total = () => Object.values(sends()).reduce((n, c) => n + c.length, 0);
const ux = (key, language) => require('../../shared/config/ux-strings').resolveUx(key, { language });
const user = (lang = 'en') => ({ ...TEACHER, preferred_language: lang });
const lesson = () => ({
  coaching_sessions: [{
    id: 'e0000000-0000-4000-8000-0000000000a1', user_id: TEACHER.id, status: 'completed', observation_type: null,
    created_at: '2026-10-10T05:00:00Z', transcript_text: 'x'.repeat(4000), analysis_data: { topic: 'Fractions', subject: 'maths' },
  }],
});

beforeEach(() => {
  process.env = { ...SAVED, WEB_QUIZ_TOKEN_SECRET: 'maker-test-secret', WEB_QUIZ_BASE_URL: 'https://quiz.example', WEB_QUIZ_KID_KEY: 'maker-test-kid-key' };
  delete process.env.REDIS_URL;
  delete process.env.QUIZ_MENU_LESSON_ROWS;
});
afterAll(() => { process.env = SAVED; });

describe('switch OFF → today, byte for byte', () => {
  test.each([
    ['tqListEmpty', 'en', 'false'], ['tqListEmpty', 'ur', 'false'], ['tqListEmptyPlans', 'en', undefined], ['tqListEmptyPlans', 'ur', undefined],
  ])('no lesson → %s (%s), one send, list_empty once, no door event', async (key, lang, rowsFlag) => {
    if (rowsFlag) process.env.QUIZ_MENU_LESSON_ROWS = rowsFlag;   // unset = on (the default) → tqListEmptyPlans
    load({ on: false });
    await expect(List.showList(user(lang), PHONE, lang, 1)).resolves.toBe(true);
    expect(sends().text).toEqual([[PHONE, ux(key, lang)]]);
    expect(total()).toBe(1);
    expect(named('transcript_quiz.list_empty')).toEqual([{ userId: TEACHER.id }]);
    expect(named('onboard.quiz_door')).toEqual([]);
  });
});

describe('a known teacher WITH a lesson → today\'s list, the empty line never runs', () => {
  test('switch ON: the same list message as switch OFF; emptyLine never called', async () => {
    load({ on: false, extra: lesson() });
    await List.showList(user('en'), PHONE, 'en', 1);
    const off = JSON.stringify(sends().list);
    expect(sends().list).toHaveLength(1);

    let spy;
    load({ on: true, extra: lesson(), before: () => { spy = jest.spyOn(require(EMPTY), 'emptyLine'); } });
    await List.showList(user('en'), PHONE, 'en', 1);
    expect(JSON.stringify(sends().list)).toBe(off);
    expect(total()).toBe(1);
    expect(spy).not.toHaveBeenCalled();
    expect(named('transcript_quiz.list_empty')).toEqual([]);
    expect(named('onboard.quiz_door')).toEqual([]);
  });
});

describe('switch ON, no lesson', () => {
  test.each([['en'], ['ur']])('ledger allows → ONE maker cta (maker.empty.*, via empty), no text (%s)', async (lang) => {
    load({ on: true });
    ledgerKnowsMakerReply();
    await expect(List.showList(user(lang), PHONE, lang, 1)).resolves.toBe(true);
    const S = require('../../shared/services/first-touch/maker.fallback.strings');
    expect(total()).toBe(1);
    expect(sends().text).toHaveLength(0);
    const [[to, msg]] = sends().cta;
    expect(to).toBe(PHONE);
    expect(msg.body).toBe(S.str('maker.empty.body', lang));
    expect(msg.buttonText).toBe(S.str('maker.empty.btn', lang));
    const m = /^https:\/\/quiz\.example\/m\/([^/?#]+)$/.exec(msg.url);
    expect(m).not.toBeNull();
    const v = require('../../shared/services/first-touch/maker.token').verifyMaker(m[1]);
    expect(v && v.ok).toEqual(expect.objectContaining({ k: 'm', uid: TEACHER.id, lang, via: 'empty' }));
    expect(named('transcript_quiz.list_empty')).toEqual([{ userId: TEACHER.id }]);
    expect(named('onboard.quiz_door')).toEqual([{ door: 'empty', reply: 'maker', ukey: expect.stringMatching(/^[0-9a-f]{16}$/), w: 's' }]);
  });

  test('the ledger refuses (over the per-phone cap, or the trigger not yet listed) → today\'s string, unledgered, one send', async () => {
    load({ on: true, settings: { web_quiz_reply_cap_per_phone: 1 } });
    const Ledger = require('../../shared/services/quiz/message-ledger');
    // the day's one allowed reply is spent (today, without maker_reply in the closed list, record() refuses anyway)
    await Ledger.record({ trigger: 'maker_reply', phone: PHONE, recipient: 'teacher', initiated: 'user' });
    const counted = () => JSON.stringify(fake.db.message_ledger.filter((r) => r.count > 0));
    const before = counted();
    const record = jest.spyOn(Ledger, 'record');
    await List.showList(user('en'), PHONE, 'en', 1);
    expect(record).toHaveBeenCalledTimes(1);
    await expect(record.mock.results[0].value).resolves.toBe(false);
    expect(sends().text).toEqual([[PHONE, ux('tqListEmptyPlans', 'en')]]);
    expect(total()).toBe(1);
    expect(counted()).toBe(before);   // the cap's own capped mark may be written; no counted send is
    expect(named('transcript_quiz.list_empty')).toEqual([{ userId: TEACHER.id }]);
    expect(named('onboard.quiz_door')).toEqual([expect.objectContaining({ door: 'empty', reply: 'today', w: 's' })]);
  });

  test('the cta_url refused → the known teacher\'s 3-button fallback, still one reply', async () => {
    load({ on: true });
    ledgerKnowsMakerReply();
    WA.sendCtaUrl.mockResolvedValueOnce(false);
    await List.showList(user('en'), PHONE, 'en', 1);
    expect(sends().text).toHaveLength(0);
    expect(sends().buttons).toHaveLength(1);
    expect(sends().buttons[0][1].body).toBe('No lesson recorded yet. Pick one:');
    expect(named('transcript_quiz.list_empty')).toEqual([{ userId: TEACHER.id }]);
    expect(named('onboard.quiz_door')).toEqual([expect.objectContaining({ door: 'empty', reply: 'fallback', w: 's' })]);
  });

  test('the empty-line module throws at require → today\'s reply, list_empty once', async () => {
    load({ on: true, before: () => jest.doMock(EMPTY, () => { throw new Error('module down'); }) });
    await List.showList(user('en'), PHONE, 'en', 1);
    expect(sends().text).toEqual([[PHONE, ux('tqListEmptyPlans', 'en')]]);
    expect(total()).toBe(1);
    expect(named('transcript_quiz.list_empty')).toEqual([{ userId: TEACHER.id }]);
    jest.dontMock(EMPTY);
  });
});
