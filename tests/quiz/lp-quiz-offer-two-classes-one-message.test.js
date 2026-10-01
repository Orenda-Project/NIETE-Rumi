'use strict';
/**
 * The 15:00 lesson-plan quiz offer for TWO classes, while its intro film is still
 * being shown, is ONE message: the film as the header of a three-button message
 * (one button per class + "Not today").
 *
 * A list message cannot carry a video header, so with two or more classes the
 * offer sent the film as its own message and then the list (production, launch
 * week: ≥431 separate film messages). Three reply buttons hold two classes and
 * "Not today", so for exactly two classes the list becomes buttons and the film
 * rides on top. Nothing is dropped: each class's lesson topics (the list rows'
 * descriptions) move into the body, under the same list body text, and the film's
 * caption becomes the footer.
 *
 * Three or more classes, a title that cannot fit a 20-code-point button, or a
 * body that would overrun 1,024 code points: the film-then-list shape, unchanged.
 *
 * Only the network boundary is mocked (whatsapp.service, the supabase config, the
 * nudge store facade the other offer suites use).
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendVideoWithButtons: jest.fn().mockResolvedValue(true),
  sendVideoFromUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('m-1') }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
let mockStore;
jest.mock('../../bot/shared/services/nudges/teacher-nudges.store',
  () => require('./helpers/nudge-contract-mocks').storeFacade(() => mockStore));

const { makeSupabase } = require('./helpers/filtering-chain');
const { makeStore } = require('./helpers/nudge-contract-mocks');
const S = require('./helpers/lp-offer-scenarios');

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const Offer = require('../../bot/shared/services/nudges/lp-quiz-offer.service');

const FILM_UR = 'feature_videos/lp_quiz_intro_test_ur.mp4';
const FILM_EN = 'feature_videos/lp_quiz_intro_test_en.mp4';
const ENV = ['LP_QUIZ_OFFER_ENABLED', 'LP_QUIZ_OFFER_INTRO_VIDEO', 'LP_QUIZ_OFFER_INTRO_VIDEO_UR',
  'LP_QUIZ_OFFER_INTRO_VIDEO_EN', 'LP_QUIZ_OFFER_INTRO_VIDEO_SHOWS', 'LP_QUIZ_OFFER_NATIVE_DIGITS'];
const cp = (s) => [...String(s || '')].length;

function firstUseChain(rows) {
  return () => {
    const filters = {};
    const c = {
      select: () => c,
      eq: (f, v) => { filters[f] = v; return c; },
      single: async () => {
        const hit = rows.find((r) => Object.entries(filters).every(([f, v]) => r[f] === v));
        return hit ? { data: { ...hit }, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      },
      upsert: async (fields) => {
        const hit = rows.find((r) => r.user_id === fields.user_id && r.feature === fields.feature);
        if (hit) Object.assign(hit, fields); else rows.push({ intro_shown_count: 0, ...fields });
        return { error: null };
      },
      update: () => c,
    };
    return c;
  };
}

function install(language, seed = []) {
  const chain = firstUseChain(seed.map((r) => ({ intro_shown_count: 0, ...r })));
  const db = makeSupabase({ users: [S.teacher(language)], coaching_sessions: [], quizzes: [], teacher_nudges: [] });
  supabase.from.mockImplementation((t) => (t === 'user_feature_first_use' ? chain() : db.from(t)));
}

const TWO = () => [
  { key: 'g4_math_0', grade: 4, subject: 'math', lessons: [{ lesson_id: 'l1', topic: 'Fractions part 1' }] },
  { key: 'g5_english_1', grade: 5, subject: 'english', lessons: [{ lesson_id: 'l2', topic: 'Nouns' }, { lesson_id: 'l3', topic: 'Verbs' }] },
];

async function send(classes, language) {
  install(language);
  return Offer.send(S.nudgeRow(classes), { now: S.SEND_AT });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore = makeStore();
  for (const k of ENV) delete process.env[k];
  process.env.LP_QUIZ_OFFER_ENABLED = 'true';
  process.env.LP_QUIZ_OFFER_INTRO_VIDEO_UR = FILM_UR;
  process.env.LP_QUIZ_OFFER_INTRO_VIDEO_EN = FILM_EN;
  WhatsAppService.sendVideoWithButtons.mockResolvedValue(true);
});
afterAll(() => { for (const k of ENV) delete process.env[k]; });

describe('two classes, film still showing — one message', () => {
  test.each([['en', FILM_EN], ['ur', FILM_UR]])('%s: film header + three buttons, no separate film, no list', async (language, film) => {
    const res = await send(TWO(), language);
    expect(res.sent).toBe(true);
    expect(WhatsAppService.sendVideoFromUrl).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveMessage).not.toHaveBeenCalled();
    expect(WhatsAppService.sendVideoWithButtons).toHaveBeenCalledTimes(1);

    const [to, video, body, buttons, opts] = WhatsAppService.sendVideoWithButtons.mock.calls[0];
    expect(to).toBe('923001112222');
    expect(video).toBe(film);
    // The same ids the list rows carried, so a tap lands where a row tap did.
    expect(buttons.map((b) => b.id)).toEqual(['lpquiz_pick_nudge-1_g4_math_0', 'lpquiz_pick_nudge-1_g5_english_1', 'lpquiz_none_nudge-1']);
    expect(buttons[2].title).toBe(resolveUx('lpQuizOfferNone', { language }));
    for (const b of buttons) expect(cp(b.title)).toBeLessThanOrEqual(20);
    // Every word the two messages carried is still there.
    expect(body.startsWith(resolveUx('lpQuizOfferListBody', { language, params: { n: '2', q: '8' } }))).toBe(true);
    expect(body).toContain('Fractions part 1');
    expect(body).toContain('Nouns · Verbs');
    expect(cp(body)).toBeLessThanOrEqual(1024);
    expect(opts.footer).toBe(resolveUx('lpQuizOfferFilmCaption', { language }));
    expect(typeof opts.onMessageId).toBe('function');
  });

  test('if the one message fails, the list still goes (the offer is never lost)', async () => {
    WhatsAppService.sendVideoWithButtons.mockResolvedValue(false);
    const res = await send(TWO(), 'en');
    expect(res.sent).toBe(true);
    expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalledTimes(1);
  });
});

describe('what stays as it was', () => {
  test('three classes: film first, then the list', async () => {
    await send(S.SHAPES.list(), 'en');
    expect(WhatsAppService.sendVideoWithButtons).not.toHaveBeenCalled();
    expect(WhatsAppService.sendVideoFromUrl).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalledTimes(1);
  });

  test('two classes once the film has been shown: the plain list', async () => {
    process.env.LP_QUIZ_OFFER_INTRO_VIDEO_SHOWS = '0';
    await send(TWO(), 'en');
    expect(WhatsAppService.sendVideoWithButtons).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalledTimes(1);
  });
});

describe('a tap on one of those buttons is answered like the list row it replaces', () => {
  const USER = { id: S.T1, phone_number: '923001112222', preferred_language: 'en' };
  const sentRow = () => ({
    ...S.nudgeRow(TWO()), status: 'sent', sent_at: S.SEND_AT.toISOString(),
    context: { classes: TWO(), shape: 'list', class_count: 2 },
  });

  /** What one tap does: its return, the replies it sent, the answer it recorded. */
  async function outcome(tap, id) {
    jest.clearAllMocks();
    mockStore = makeStore([sentRow()]);
    install('en');
    const handled = await tap(id, USER.phone_number, USER, { now: new Date(S.SEND_AT.getTime() + 60000) });
    return {
      handled,
      replies: WhatsAppService.sendMessage.mock.calls.map((c) => c[1]),
      asked: WhatsAppService.sendInteractiveButtons.mock.calls.map((c) => c[1] && c[1].body),
      choice: mockStore.rows[0].choice,
    };
  }

  test.each(['lpquiz_pick_nudge-1_g4_math_0', 'lpquiz_none_nudge-1'])('%s as a BUTTON = the same id as a list row', async (id) => {
    const asRow = await outcome(Offer.handleListPick, id);
    const asButton = await outcome(Offer.handleButton, id);
    expect(asRow.handled).toBe(true);
    expect(asButton).toEqual(asRow);
  });
});
