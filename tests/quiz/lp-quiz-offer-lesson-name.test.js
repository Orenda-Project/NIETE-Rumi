'use strict';
/**
 * The afternoon offer names the lesson the way its own PDF does.
 *
 * The v8 catalog carries two names per lesson. `topic` is the clean name the
 * lesson PDF's caption prints ("Comparing & ordering unlike fractions").
 * `topic_short` is the row's run-on sub-headings, cut at 80 code points
 * ("Comparing / Ordering Unlike Fractions / Discovery / Skill Sharpener —
 * Comparing…"). The offer used `topic_short` first, so a teacher who took the
 * PDF at 09:30 was offered a quiz at 15:00 on a lesson whose name they had
 * never seen, ending in an ellipsis.
 *
 * The build runs for real against a filtering supabase stub and the real
 * catalog; the send runs for real with WhatsApp mocked at its boundary.
 */

const { makeSupabase } = require('./helpers/filtering-chain');
const { makeStore } = require('./helpers/nudge-contract-mocks');
const pktTime = require('../../bot/shared/services/nudges/pkt-time');

const NUDGE_DATE = '2026-09-22';          // Tuesday
const T1 = '11111111-1111-4111-8111-111111111111';

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue('m-1'),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

let mockStore;
jest.mock('../../bot/shared/services/nudges/teacher-nudges.store',
  () => require('./helpers/nudge-contract-mocks').storeFacade(() => mockStore));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const Offer = require('../../bot/shared/services/nudges/lp-quiz-offer.service');

const cp = (s) => [...String(s || '')].length;
const pkt = (date, h, m = 0) => pktTime.atPkt(date, h, m);

/** A lesson whose two catalog names differ — the one caught live on sandbox. */
const FRACTIONS = 'grade_4_math_ch5_seg3';
/** The longest clean name in the K-5 catalog (211 code points). */
const LONGEST = 'grade_1_urdu_ch6_seg6';

function download(over = {}) {
  return {
    id: `d-${Math.random().toString(36).slice(2, 8)}`,
    user_id: T1,
    lesson_id: FRACTIONS,
    asset_id: 'asset-lesson-1',
    version_stamp: 'v8.2026-09-01',
    content_hash: 'hash-aaa',
    grade: 4,
    subject: 'math',
    chapter_number: 5,
    segment_index: 3,
    status: 'sent',
    phone: '923001112222',
    created_at: pkt(NUDGE_DATE, 9, 30).toISOString(),
    ...over,
  };
}

function world(downloads) {
  return {
    niete_lp_downloads: downloads,
    niete_lp_assets: [
      { id: 'asset-lesson-1', asset_kind: 'lesson' },
      { id: 'asset-lesson-2', asset_kind: 'lesson' },
    ],
    users: [{
      id: T1, role: 'teacher', is_test_user: false, deleted_at: null, school_id: 'school-1', region: 'Sihala',
      phone_number: '923001112222', preferred_language: 'en', last_message_at: pkt(NUDGE_DATE, 12, 0).toISOString(),
    }],
    schools: [{ id: 'school-1', region: 'Sihala' }],
    coaching_sessions: [],
    quizzes: [],
    teacher_nudges: [],
  };
}

function install(tables) {
  const db = makeSupabase(tables);
  supabase.from.mockImplementation(db.from);
}

async function buildAndSend(downloads) {
  install(world(downloads));
  await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
  const row = mockStore.rows[0];
  const res = await Offer.send({ ...row, status: 'sending' }, { now: pkt(NUDGE_DATE, 15, 0) });
  return { row, res };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore = makeStore();
  process.env.LP_QUIZ_OFFER_ENABLED = 'true';
  process.env.LP_QUIZ_OFFER_SEND_HOUR_PKT = '15';
  process.env.LP_QUIZ_OFFER_SEND_MINUTE_PKT = '0';
  process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT = '14';
  delete process.env.LP_QUIZ_OFFER_SECTORS;
});

afterEach(() => {
  delete process.env.LP_QUIZ_OFFER_ENABLED;
  delete process.env.LP_QUIZ_OFFER_SEND_HOUR_PKT;
  delete process.env.LP_QUIZ_OFFER_SEND_MINUTE_PKT;
  delete process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT;
});

describe('the lesson name in the offer is the name on its PDF', () => {
  test('the premise: this lesson\'s two catalog names really differ', () => {
    const { lesson } = Catalog.lessonById(FRACTIONS);
    expect(lesson.topic).toBe('Comparing & ordering unlike fractions');
    expect(lesson.topic_short).not.toBe(lesson.topic);
    expect(lesson.topic_short).toMatch(/Skill Sharpener/);
  });

  test('the build stamps the clean catalog topic on the lesson it books', async () => {
    install(world([download()]));
    await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    const [lesson] = mockStore.rows[0].context.classes[0].lessons;
    expect(lesson.topic).toBe('Comparing & ordering unlike fractions');
  });

  test('a one-lesson offer names the lesson by its clean name, with no run-on sub-headings', async () => {
    await buildAndSend([download()]);
    const [, opts] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(opts.body).toContain('“Comparing & ordering unlike fractions”');
    expect(opts.body).not.toMatch(/Skill Sharpener|Discovery|…/);
  });

  test('a list row describes each class by its lessons\' clean names, inside the 72-code-point cap', async () => {
    await buildAndSend([
      download(),
      download({
        lesson_id: LONGEST, asset_id: 'asset-lesson-2', grade: 1, subject: 'urdu', chapter_number: 6, segment_index: 6,
      }),
    ]);
    const [, list] = WhatsAppService.sendInteractiveMessage.mock.calls[0];
    const rows = list.action.sections[0].rows.filter((r) => r.description);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(cp(r.description)).toBeLessThanOrEqual(72);
    const maths = rows.find((r) => r.id.endsWith('_g4_math'));
    expect(maths.description).toBe('Comparing & ordering unlike fractions');
    // The 211-code-point name is clipped to fit, never sent whole to Meta.
    const urdu = rows.find((r) => r.id.endsWith('_g1_urdu'));
    const clean = Catalog.lessonById(LONGEST).lesson.topic;
    expect(urdu.description.endsWith('…')).toBe(true);
    expect(clean.startsWith(urdu.description.slice(0, 20))).toBe(true);
  });
});

describe('a catalog row with no clean name still names the lesson', () => {
  test('topic_short is the fallback when topic is missing', () => {
    jest.isolateModules(() => {
      const IsolatedCatalog = require('../../bot/shared/services/lp-v8-catalog.service');
      IsolatedCatalog.__setCatalogForTests({
        books: [{
          grade: 4, subject: 'Mathematics', subject_key: 'math',
          chapters: [{ number: 1, title: 'c', lessons: [{ lesson_id: 'x_seg1', topic_short: 'Short name only' }] }],
        }],
      });
      const IsolatedOffer = require('../../bot/shared/services/nudges/lp-quiz-offer.service');
      const [grouped] = IsolatedOffer.groupLessons([{
        user_id: T1, lesson_id: 'x_seg1', asset_id: 'a', version_stamp: 'v', content_hash: 'h',
        grade: 4, subject: 'math', created_at: pkt(NUDGE_DATE, 9, 0).toISOString(),
      }]);
      expect(grouped.classes[0].lessons[0].topic).toBe('Short name only');
    });
  });
});
