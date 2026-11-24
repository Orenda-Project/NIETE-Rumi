'use strict';
/**
 * bd-97daxo.34.6 — the 15:00 quiz offer reaches the Grades 6-12 and GB teachers too.
 *
 * Their lessons are rows in `niete_lp612_deliveries` (WhatsApp, portal or backfill), not
 * `niete_lp_downloads`, so the K-5 cohort never saw them. The cohort now also reads the day's
 * 6-12 deliveries and offers each class's newest lesson; a tap makes the quiz through the lp612
 * provider (the same one /quiz uses), so one quiz per lesson holds whichever door asked.
 */

const { makeSupabase } = require('./helpers/filtering-chain');
const { makeStore } = require('./helpers/nudge-contract-mocks');
const pktTime = require('../../bot/shared/services/nudges/pkt-time');

const NUDGE_DATE = '2026-09-22';          // Tuesday
const ICT = '11111111-1111-4111-8111-111111111111';
const GB = '22222222-2222-4222-8222-222222222222';
const SEG_ICT = 'grade_8_mathematics.c04.p047-050';
const SEG_GB = 'gb_grade_3_mathematics.c02.p010-012';

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('m-1') }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

let mockStore;
jest.mock('../../bot/shared/services/nudges/teacher-nudges.store',
  () => require('./helpers/nudge-contract-mocks').storeFacade(() => mockStore));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Offer = require('../../bot/shared/services/nudges/lp-quiz-offer.service');
const Provider = require('../../bot/shared/services/quiz/providers/lp612.provider');

const pkt = (date, h, m = 0) => pktTime.atPkt(date, h, m);

function delivery(over = {}) {
  return {
    id: `dl-${Math.random().toString(36).slice(2, 8)}`,
    user_id: ICT,
    render_id: 'render-1',
    segment_id: SEG_ICT,
    lang: 'en',
    template_version: 'v9',
    surface: 'whatsapp',
    delivered_at: pkt(NUDGE_DATE, 9, 30).toISOString(),
    ...over,
  };
}

function segment(id, over = {}) {
  return {
    segment_id: id, grade: 8, subject: 'Mathematics', subtopic_title: 'Linear equations',
    menu_title: 'Ch 4', lp_type: 'lesson', is_religious: false, curriculum: 'ict', ...over,
  };
}

function teacher(id) {
  return {
    id, role: 'teacher', is_test_user: false, deleted_at: null, school_id: 'school-1', region: 'Sihala',
    phone_number: id === ICT ? '923001112222' : '923003334444', preferred_language: 'en',
    last_message_at: pkt(NUDGE_DATE, 10, 0).toISOString(),
  };
}

function install(over = {}) {
  const db = makeSupabase({
    niete_lp_downloads: [],
    niete_lp_assets: [],
    niete_lp_asset_sources: [],
    niete_lp_opens: [],
    niete_lp612_deliveries: [
      delivery({ id: 'dl-ict' }),
      delivery({ id: 'dl-gb', user_id: GB, segment_id: SEG_GB, surface: 'portal' }),
    ],
    niete_lp612_segments: [
      segment(SEG_ICT),
      segment(SEG_GB, { grade: 3, subtopic_title: 'Common Fractions', curriculum: 'gb' }),
      segment('grade_8_mathematics.c04.assess', { lp_type: 'assessment' }),
      segment('grade_8_islamiyat.c01.p001', { subject: 'Islamiyat', is_religious: true }),
    ],
    users: [teacher(ICT), teacher(GB)],
    schools: [{ id: 'school-1', region: 'Sihala' }],
    coaching_sessions: [],
    quizzes: [],
    teacher_nudges: [],
    ...over,
  });
  supabase.from.mockImplementation(db.from);
  return db;
}

const build = () => Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
const rowOf = (userId) => mockStore.rows.find((r) => r.user_id === userId);

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  mockStore = makeStore();
  if (Offer.forgetEmptyDays) Offer.forgetEmptyDays();
  process.env.LP_QUIZ_OFFER_ENABLED = 'true';
  process.env.LP_QUIZ_OFFER_SEND_HOUR_PKT = '15';
  process.env.LP_QUIZ_OFFER_SEND_MINUTE_PKT = '0';
  process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT = '14';
  process.env.QUIZ_LP612_SOURCE = 'on';
  process.env.LP_QUIZ_OFFER_ICT612 = 'on';
  delete process.env.LP_QUIZ_OFFER_SECTORS;
  delete process.env.TRANSCRIPT_QUIZ_SUBJECTS;
  delete process.env.LP_612_RELIGIOUS_ENABLED;
});

describe('15:00 offer: Grades 6-12 and GB lessons', () => {
  test('an ICT 6-12 WhatsApp lesson and a GB portal lesson each earn an offer naming the lesson', async () => {
    install();
    const res = await build();
    expect(res.inserted).toBe(2);

    const ict = rowOf(ICT);
    expect(ict.status).toBe('pending');
    expect(ict.context.classes).toHaveLength(1);
    const cls = ict.context.classes[0];
    expect(cls.source).toBe('lp612');
    expect(cls.key).toMatch(/^lp612_[a-z0-9_]+$/);
    expect(cls.grade).toBe(8);
    expect(cls.lessons).toHaveLength(1);
    expect(cls.lessons[0]).toEqual(expect.objectContaining({ lesson_ref: 'dl-ict', segment_id: SEG_ICT, topic: 'Linear equations' }));

    const gb = rowOf(GB);
    expect(gb.status).toBe('pending');
    expect(gb.context.classes[0].lessons[0]).toEqual(expect.objectContaining({ lesson_ref: 'dl-gb', topic: 'Common Fractions' }));
  });

  test('a lesson taken after the cutoff waits for the next school day', async () => {
    install({ niete_lp612_deliveries: [delivery({ id: 'dl-late', delivered_at: pkt(NUDGE_DATE, 14, 30).toISOString() })] });
    const res = await build();
    expect(res.inserted).toBe(0);
    expect(mockStore.rows).toHaveLength(0);
  });

  test('assessment and held lessons are not offered; the teacher is skipped as no_lesson', async () => {
    install({
      niete_lp612_deliveries: [
        delivery({ id: 'dl-a', segment_id: 'grade_8_mathematics.c04.assess' }),
        delivery({ id: 'dl-r', segment_id: 'grade_8_islamiyat.c01.p001' }),
      ],
    });
    const res = await build();
    expect(res.inserted).toBe(0);
    expect(rowOf(ICT).status).toBe('skipped');
    expect(rowOf(ICT).context.skip_reason).toBe('no_lesson');
  });

  test('a lesson she already made a quiz from is not offered again', async () => {
    install({
      niete_lp612_deliveries: [delivery({ id: 'dl-ict' })],
      quizzes: [{
        id: 'q-old', teacher_id: ICT, quiz_source: 'lp612', status: 'sent',
        created_at: pkt('2026-09-21', 12, 0).toISOString(),
        meta: { lessons: [{ segment_id: SEG_ICT, lang: 'en' }] },
      }],
    });
    const res = await build();
    expect(res.inserted).toBe(0);
    expect(rowOf(ICT).context.skip_reason).toBe('no_lesson');
  });

  test('QUIZ_LP612_SOURCE off: no 6-12 lesson is read or offered', async () => {
    process.env.QUIZ_LP612_SOURCE = 'off';
    install();
    const res = await build();
    expect(res.inserted).toBe(0);
    expect(mockStore.rows).toHaveLength(0);
  });
});

// q250 (24 Nov): production offers GB grade 1-5 only; ICT 6-12 waits behind LP_QUIZ_OFFER_ICT612.
describe('LP_QUIZ_OFFER_ICT612 not on: GB grade 1-5 only', () => {
  beforeEach(() => { delete process.env.LP_QUIZ_OFFER_ICT612; });

  test('the GB grade 3 lesson is offered; the ICT grade 8 teacher is skipped as no_lesson', async () => {
    install();
    const res = await build();
    expect(res.inserted).toBe(1);
    expect(rowOf(GB).status).toBe('pending');
    expect(rowOf(GB).context.classes[0].lessons[0]).toEqual(expect.objectContaining({ lesson_ref: 'dl-gb' }));
    expect(rowOf(ICT).status).toBe('skipped');
    expect(rowOf(ICT).context.skip_reason).toBe('no_lesson');
  });

  test('a GB grade 7 lesson (GB 6-12 is design pending) is not offered', async () => {
    install({
      niete_lp612_deliveries: [delivery({ id: 'dl-gb7', user_id: GB, segment_id: 'gb_grade_7_science.c01.p001' })],
      niete_lp612_segments: [segment('gb_grade_7_science.c01.p001', { grade: 7, subject: 'Science', curriculum: 'gb' })],
    });
    const res = await build();
    expect(res.inserted).toBe(0);
    expect(rowOf(GB).context.skip_reason).toBe('no_lesson');
  });

  test('`off` keeps ICT 6-12 out too', async () => {
    process.env.LP_QUIZ_OFFER_ICT612 = 'off';
    install();
    const res = await build();
    expect(res.inserted).toBe(1);
    expect(rowOf(ICT).status).toBe('skipped');
  });
});

describe('the tap on a 6-12 offer', () => {
  async function sentOffer() {
    install();
    await build();
    const row = rowOf(ICT);
    row.status = 'sent';
    row.sent_at = pkt(NUDGE_DATE, 15, 0).toISOString();
    return row;
  }

  test('makes the quiz through the lp612 provider from that delivery and claims the offer', async () => {
    const row = await sentOffer();
    const start = jest.spyOn(Provider, 'start').mockResolvedValue({ outcome: 'asked', quizId: 'q-new' });
    const handled = await Offer.handleButton(`lpquiz_yes_${row.id}`, '923001112222', teacher(ICT), { now: pkt(NUDGE_DATE, 15, 5) });

    expect(handled).toBe(true);
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ id: ICT }), 'dl-ict', expect.objectContaining({ phone: '923001112222', via: 'lp_offer' }),
    );
    expect(row.quiz_id).toBe('q-new');
    expect(row.choice).toBe('yes');
  });

  test('a lesson already quizzed is answered with the quiz she has, and no new one is claimed', async () => {
    const row = await sentOffer();
    jest.spyOn(Provider, 'start').mockResolvedValue({ outcome: 'already', quizId: 'q-old', existing: { id: 'q-old' } });
    await Offer.handleButton(`lpquiz_yes_${row.id}`, '923001112222', teacher(ICT), { now: pkt(NUDGE_DATE, 15, 5) });

    expect(row.quiz_id).toBeFalsy();
    const said = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n');
    expect(said).toMatch(/already/i);
  });
});

describe('15:00 offer: a 6-12 failure never stops the K-5 offer (bd-97daxo.34.10)', () => {
  test('a failed 6-12 read is logged and the cohort still builds, with no 6-12 rows', async () => {
    install();
    jest.spyOn(Provider, 'segmentsById').mockRejectedValue(new Error('segments read failed'));
    const { logEvent } = require('../../bot/shared/utils/structured-logger');

    await expect(build()).resolves.toEqual(expect.objectContaining({ inserted: 0 }));
    expect(logEvent).toHaveBeenCalledWith('lp_quiz_offer.cohort_612_failed',
      expect.objectContaining({ nudgeDate: NUDGE_DATE, error: 'segments read failed' }));
  });
});
