'use strict';
/**
 * The 15:00 lesson-plan quiz offer: its intro film and its numerals.
 *
 * THE FILM. The coaching offer's first showings carry an intro film as the
 * video header of the button message; the lesson-plan offer carried none. It
 * now follows the same pattern: a per-language film (LP_QUIZ_OFFER_INTRO_VIDEO_UR
 * / _EN, shared LP_QUIZ_OFFER_INTRO_VIDEO as fallback), shown while the teacher's
 * count is under LP_QUIZ_OFFER_INTRO_VIDEO_SHOWS (default 1, 0 = never), counted
 * under its OWN FeatureIntro key so the coaching film's count is never touched.
 * A list message cannot carry a video header, so a list offer sends the film
 * first as its own message and the list after it. Unset, nothing changes.
 *
 * THE NUMERALS. The offer used Urdu digits (۸ ۴) where the coaching offer and
 * the teacher's pre-send PDF use Western ones inside Urdu. Western is now the
 * default; LP_QUIZ_OFFER_NATIVE_DIGITS=on brings the Urdu digits back.
 *
 * Only the network boundary is mocked (whatsapp.service, the supabase config).
 * FeatureIntro is the real module, writing to an in-memory user_feature_first_use
 * that enforces the table's UNIQUE (user_id, feature).
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendVideoWithButtons: jest.fn().mockResolvedValue(true),
  sendVideoFromUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
let mockStore;
jest.mock('../../bot/shared/services/nudges/teacher-nudges.store',
  () => require('./helpers/nudge-contract-mocks').storeFacade(() => mockStore));

const { makeSupabase } = require('./helpers/filtering-chain');
const { makeStore } = require('./helpers/nudge-contract-mocks');
const S = require('./helpers/lp-offer-scenarios');
const GOLDEN = require('./__fixtures__/lp-quiz-offer-sends.base.json');

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { logToFile } = require('../../bot/shared/utils/logger');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
const Offer = require('../../bot/shared/services/nudges/lp-quiz-offer.service');

const FILM_UR = 'feature_videos/lp_quiz_intro_test_ur.mp4';
const FILM_EN = 'feature_videos/lp_quiz_intro_test_en.mp4';
const ENV = [
  'LP_QUIZ_OFFER_ENABLED', 'LP_QUIZ_OFFER_INTRO_VIDEO', 'LP_QUIZ_OFFER_INTRO_VIDEO_UR', 'LP_QUIZ_OFFER_INTRO_VIDEO_EN',
  'LP_QUIZ_OFFER_INTRO_VIDEO_SHOWS', 'LP_QUIZ_OFFER_NATIVE_DIGITS',
];

/**
 * user_feature_first_use as the table has it: one row per (user_id, feature),
 * an upsert on that pair, intro_shown_count defaulting to 0.
 */
function makeFirstUse(seed = []) {
  const rows = seed.map((r) => ({ intro_shown_count: 0, ...r }));
  const upserts = [];
  const chain = () => {
    const filters = {};
    const c = {
      select: () => c,
      eq: (f, v) => { filters[f] = v; return c; },
      single: async () => {
        const hit = rows.find((r) => Object.entries(filters).every(([f, v]) => r[f] === v));
        return hit ? { data: { ...hit }, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      },
      upsert: async (fields, opts) => {
        upserts.push({ fields, opts });
        if (!opts || opts.onConflict !== 'user_id,feature') throw new Error('upsert without the table key');
        const hit = rows.find((r) => r.user_id === fields.user_id && r.feature === fields.feature);
        if (hit) Object.assign(hit, fields);
        else rows.push({ intro_shown_count: 0, ...fields });
        return { error: null };
      },
      update: () => c,
    };
    return c;
  };
  return { rows, upserts, chain, count: (feature) => (rows.find((r) => r.feature === feature) || {}).intro_shown_count };
}

let firstUse;
let db;
function install(language, { seed = [] } = {}) {
  firstUse = makeFirstUse(seed);
  db = makeSupabase({ users: [S.teacher(language)], coaching_sessions: [], quizzes: [], teacher_nudges: [] });
  supabase.from.mockImplementation((table) => (table === 'user_feature_first_use' ? firstUse.chain() : db.from(table)));
}

async function send(shape, language, opts) {
  install(language, opts);
  return Offer.send(S.nudgeRow(S.SHAPES[shape]()), { now: S.SEND_AT });
}

const sentEvent = () => logEvent.mock.calls.filter(([name]) => name === 'lp_quiz.offer_sent').map(([, d]) => d)[0];
const toWestern = (s) => String(s).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const cp = (s) => [...String(s || '')].length;

beforeEach(() => {
  jest.clearAllMocks();
  mockStore = makeStore();
  for (const k of ENV) delete process.env[k];
  process.env.LP_QUIZ_OFFER_ENABLED = 'true';
  WhatsAppService.sendInteractiveButtons.mockResolvedValue(true);
  WhatsAppService.sendInteractiveMessage.mockResolvedValue(true);
  WhatsAppService.sendVideoWithButtons.mockResolvedValue(true);
  WhatsAppService.sendVideoFromUrl.mockResolvedValue(true);
});
afterAll(() => { for (const k of ENV) delete process.env[k]; });

// ── unset: exactly what the offer sent before ───────────────────────────────

describe('no film configured — the sends are the ones the offer made before', () => {
  const cases = S.LANGUAGES.flatMap((l) => Object.keys(S.SHAPES).map((s) => [l, s]));

  test.each(cases)('%s %s with LP_QUIZ_OFFER_NATIVE_DIGITS=on is byte-identical to the golden', async (language, shape) => {
    process.env.LP_QUIZ_OFFER_NATIVE_DIGITS = 'on';
    const res = await send(shape, language);
    expect(res.sent).toBe(true);
    expect(S.recordedCalls(WhatsAppService)).toEqual(GOLDEN[`${language}.${shape}`].calls);
  });

  test.each(cases)('%s %s by default differs from the golden only in its digits', async (language, shape) => {
    await send(shape, language);
    const expected = JSON.parse(toWestern(JSON.stringify(GOLDEN[`${language}.${shape}`].calls)));
    expect(S.recordedCalls(WhatsAppService)).toEqual(expected);
  });

  test('FeatureIntro is neither read nor written when no film is set', async () => {
    await send('one', 'ur');
    await send('list', 'en');
    expect(supabase.from.mock.calls.map(([t]) => t)).not.toContain('user_feature_first_use');
    expect(sentEvent()).toMatchObject({ withVideo: false, shownCount: 0 });
  });
});

// ── buttons shapes: the film is the header ──────────────────────────────────

describe('one class — the film rides the offer as its video header', () => {
  beforeEach(() => {
    process.env.LP_QUIZ_OFFER_INTRO_VIDEO_UR = FILM_UR;
    process.env.LP_QUIZ_OFFER_INTRO_VIDEO_EN = FILM_EN;
  });

  test.each([['ur', FILM_UR], ['en', FILM_EN]])('a %s teacher gets the %s film with the same body, buttons and send opts', async (language, film) => {
    const res = await send('one', language);
    expect(res.sent).toBe(true);
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(WhatsAppService.sendVideoWithButtons).toHaveBeenCalledTimes(1);
    const [to, video, body, buttons, opts] = WhatsAppService.sendVideoWithButtons.mock.calls[0];
    const plain = GOLDEN[`${language}.one`].calls[0].args[1];
    expect(to).toBe('923001112222');
    expect(video).toBe(film);
    expect(body).toBe(toWestern(plain.body));
    expect(buttons).toEqual(plain.buttons);
    expect(typeof opts.onMessageId).toBe('function');
    expect(firstUse.count('lp_quiz_offer')).toBe(1);
    expect(sentEvent()).toMatchObject({ withVideo: true, shownCount: 0 });
  });

  test('the class shape carries it too', async () => {
    await send('class', 'ur');
    expect(WhatsAppService.sendVideoWithButtons).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendVideoWithButtons.mock.calls[0][1]).toBe(FILM_UR);
  });

  test('the shared film stands in for a language that has none', async () => {
    delete process.env.LP_QUIZ_OFFER_INTRO_VIDEO_EN;
    process.env.LP_QUIZ_OFFER_INTRO_VIDEO = 'feature_videos/lp_shared.mp4';
    await send('one', 'en');
    expect(WhatsAppService.sendVideoWithButtons.mock.calls[0][1]).toBe('feature_videos/lp_shared.mp4');
  });

  test('once the count is reached, plain buttons', async () => {
    const res = await send('one', 'ur', { seed: [{ user_id: S.T1, feature: 'lp_quiz_offer', intro_shown_count: 1 }] });
    expect(res.sent).toBe(true);
    expect(WhatsAppService.sendVideoWithButtons).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    expect(firstUse.count('lp_quiz_offer')).toBe(1);
    expect(sentEvent()).toMatchObject({ withVideo: false, shownCount: 1 });
  });

  test('LP_QUIZ_OFFER_INTRO_VIDEO_SHOWS raises the count; 0 means never', async () => {
    process.env.LP_QUIZ_OFFER_INTRO_VIDEO_SHOWS = '2';
    await send('one', 'ur', { seed: [{ user_id: S.T1, feature: 'lp_quiz_offer', intro_shown_count: 1 }] });
    expect(WhatsAppService.sendVideoWithButtons).toHaveBeenCalledTimes(1);
    expect(firstUse.count('lp_quiz_offer')).toBe(2);

    jest.clearAllMocks();
    process.env.LP_QUIZ_OFFER_INTRO_VIDEO_SHOWS = '0';
    await send('one', 'ur');
    expect(WhatsAppService.sendVideoWithButtons).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
  });

  test('the coaching film\'s count is its own — neither read as ours nor written', async () => {
    const seed = [{ user_id: S.T1, feature: 'transcript_quiz', intro_shown_count: 5 }];
    await send('one', 'ur', { seed });
    expect(WhatsAppService.sendVideoWithButtons).toHaveBeenCalledTimes(1);
    expect(firstUse.count('transcript_quiz')).toBe(5);
    expect(firstUse.count('lp_quiz_offer')).toBe(1);
    expect(firstUse.upserts.every((u) => u.fields.feature === 'lp_quiz_offer')).toBe(true);
  });

  test('a failed film falls back to plain buttons, is logged, and is not counted', async () => {
    WhatsAppService.sendVideoWithButtons.mockResolvedValue(false);
    const res = await send('one', 'ur');
    expect(res.sent).toBe(true);
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    const [, payload, opts] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(payload.body).toBe(toWestern(GOLDEN['ur.one'].calls[0].args[1].body));
    expect(typeof opts.onMessageId).toBe('function');
    expect(firstUse.count('lp_quiz_offer') || 0).toBe(0);
    expect(logToFile.mock.calls.some(([msg, , level]) => /video/i.test(msg) && level === 'warn')).toBe(true);
    expect(sentEvent()).toMatchObject({ withVideo: false, shownCount: 0 });
  });
});

// ── list shape: the film first, then the list ───────────────────────────────

describe('several classes — a list cannot carry a video, so the film goes first', () => {
  beforeEach(() => {
    process.env.LP_QUIZ_OFFER_INTRO_VIDEO_UR = FILM_UR;
    process.env.LP_QUIZ_OFFER_INTRO_VIDEO_EN = FILM_EN;
  });

  test.each([['ur', FILM_UR], ['en', FILM_EN]])('%s: the film message, then the unchanged list', async (language, film) => {
    const res = await send('list', language);
    expect(res.sent).toBe(true);
    const calls = S.recordedCalls(WhatsAppService);
    expect(calls.map((c) => c.method)).toEqual(['sendVideoFromUrl', 'sendInteractiveMessage']);
    const [to, video, caption] = calls[0].args;
    expect(to).toBe('923001112222');
    expect(video).toBe(film);
    expect(caption).toBe(UX_STRINGS.lpQuizOfferFilmCaption[language]);
    expect(calls[1]).toEqual(JSON.parse(toWestern(JSON.stringify(GOLDEN[`${language}.list`].calls[0]))));
    expect(firstUse.count('lp_quiz_offer')).toBe(1);
    expect(sentEvent()).toMatchObject({ withVideo: true, shownCount: 0 });
  });

  test('the list waits for the film — it is not sent until the film send settles', async () => {
    let release;
    WhatsAppService.sendVideoFromUrl.mockImplementation(() => new Promise((r) => { release = r; }));
    install('ur');
    const pending = Offer.send(S.nudgeRow(S.SHAPES.list()), { now: S.SEND_AT });
    for (let i = 0; i < 20 && !release; i += 1) await new Promise((r) => setImmediate(r));
    expect(WhatsAppService.sendVideoFromUrl).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendInteractiveMessage).not.toHaveBeenCalled();
    release(true);
    await pending;
    expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalledTimes(1);
  });

  test('a failed film still sends the list, and is not counted', async () => {
    WhatsAppService.sendVideoFromUrl.mockResolvedValue(false);
    const res = await send('list', 'ur');
    expect(res.sent).toBe(true);
    expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalledTimes(1);
    expect(firstUse.count('lp_quiz_offer') || 0).toBe(0);
    expect(logToFile.mock.calls.some(([msg, , level]) => /video/i.test(msg) && level === 'warn')).toBe(true);
    expect(sentEvent()).toMatchObject({ withVideo: false });
  });

  test('once the count is reached, the list alone', async () => {
    await send('list', 'en', { seed: [{ user_id: S.T1, feature: 'lp_quiz_offer', intro_shown_count: 1 }] });
    expect(S.recordedCalls(WhatsAppService).map((c) => c.method)).toEqual(['sendInteractiveMessage']);
  });

  test('the caption exists in both languages and is short', () => {
    for (const l of S.LANGUAGES) {
      expect(typeof UX_STRINGS.lpQuizOfferFilmCaption[l]).toBe('string');
      expect(cp(UX_STRINGS.lpQuizOfferFilmCaption[l])).toBeLessThanOrEqual(60);
    }
  });
});

// ── numerals ────────────────────────────────────────────────────────────────

describe('numerals — Western by default, like the coaching offer and the PDF', () => {
  const URDU_DIGIT = /[۰-۹]/;

  test.each(Object.keys(S.SHAPES))('ur %s: no Urdu digit anywhere in the offer; the question count is 8', async (shape) => {
    await send(shape, 'ur');
    const text = JSON.stringify(S.recordedCalls(WhatsAppService));
    expect(text).not.toMatch(URDU_DIGIT);
    expect(text).toMatch(/8 سوالوں/);
  });

  test('ur list rows and footer carry Western grades and counts', async () => {
    await send('list_more', 'ur');
    const list = WhatsAppService.sendInteractiveMessage.mock.calls[0][1];
    const titles = list.action.sections[0].rows.map((r) => r.title);
    expect(titles[0]).toBe('جماعت 1 · ریاضی');
    expect(list.footer).toContain('3');
    expect(list.body.text).toContain('12');
    for (const r of list.action.sections[0].rows) {
      expect(cp(r.title)).toBeLessThanOrEqual(24);
      if (r.description) expect(cp(r.description)).toBeLessThanOrEqual(72);
    }
    expect(cp(list.footer)).toBeLessThanOrEqual(60);
  });

  test('LP_QUIZ_OFFER_NATIVE_DIGITS=on is read at call time and brings the Urdu digits back', async () => {
    await send('class', 'ur');
    expect(WhatsAppService.sendInteractiveButtons.mock.calls[0][1].body).toMatch(/جماعت 4 .* 3 اسباق .* 8 سوالوں/s);
    jest.clearAllMocks();
    process.env.LP_QUIZ_OFFER_NATIVE_DIGITS = 'on';
    await send('class', 'ur');
    expect(WhatsAppService.sendInteractiveButtons.mock.calls[0][1].body).toMatch(/جماعت ۴ .* ۳ اسباق .* ۸ سوالوں/s);
  });

  test('English is unaffected by the switch', async () => {
    process.env.LP_QUIZ_OFFER_NATIVE_DIGITS = 'on';
    await send('list', 'en');
    expect(JSON.stringify(S.recordedCalls(WhatsAppService))).not.toMatch(URDU_DIGIT);
  });

  test('every offer template carries its question count as {q}, in both languages', () => {
    for (const key of ['lpQuizOfferOne', 'lpQuizOfferOneUntitled', 'lpQuizOfferClass', 'lpQuizOfferListBody']) {
      for (const l of S.LANGUAGES) {
        expect(UX_STRINGS[key][l]).toContain('{q}');
        expect(UX_STRINGS[key][l]).not.toMatch(/[۰-۹]/);
      }
    }
  });
});
