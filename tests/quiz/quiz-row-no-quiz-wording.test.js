'use strict';
/**
 * ONE phrase in /quiz for "no quiz has been made for this lesson yet".
 *
 * The staging E2E (25 Sep) read two rows of the same Flow screen side by side:
 * an un-made lesson plan said "No quiz yet", and a recorded lesson whose
 * coaching offer had not been answered said "Not made yet" (the list message
 * said "Offered — tap to make" for it). To the teacher the two states are the
 * same — nothing is made, and a tap makes it (or asks the language first) — so
 * both surfaces now say the same words for both, in both languages.
 *
 * Driven through the real /quiz Flow endpoint and the real list message, over
 * an in-memory database; the network boundary is mocked.
 */

const { makeDb } = require('./helpers/memory-db');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  redis: { get: jest.fn(async () => null), set: jest.fn(), del: jest.fn() },
  isAvailable: () => true,
  get: jest.fn(async () => null),
  set: jest.fn(async () => true),
  setNX: jest.fn(async () => true),
  delete: jest.fn(async () => true),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue({ MessageId: 'm-1' }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => {
  const actual = jest.requireActual('../../bot/shared/utils/structured-logger');
  return { ...actual, logEvent: jest.fn() };
});

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Endpoint = require('../../bot/shared/routes/transcript-quiz-flow-endpoint');
const List = require('../../bot/shared/services/quiz/transcript-quiz-list.service');

const T = 'u-teacher';
const PHONE = '923001112222';
const TOKEN = `${T}:transcript-quiz:1`;

function pkt(days, hourPkt) {
  const d = new Date(Date.now() - days * 86400000);
  const ymd = new Date(d.getTime() + 5 * 3600000).toISOString().slice(0, 10);
  return new Date(`${ymd}T${String(hourPkt).padStart(2, '0')}:00:00+05:00`).toISOString();
}
const A_MATH = {
  id: 'a-math', lesson_id: 'grade_4_math_ch1_seg1', asset_kind: 'lesson', version_stamp: 'v8-a-math', content_hash: 'h-a-math', is_current: true,
};
const REC = {
  id: 'cs-1', user_id: T, status: 'completed', observation_type: null, created_at: pkt(5, 9),
  transcript_text: 'x'.repeat(4000), analysis_data: { topic: 'Photosynthesis', subject: 'science' },
};
// The coaching offer went out and was never answered: an `offered` quiz on the recording.
const OFFERED = {
  id: 'q-offered', teacher_id: T, coaching_session_id: 'cs-1', quiz_source: 'transcript', status: 'offered',
  topic: 'Photosynthesis', subject: 'science', language: null, meta: { source: 'self', step: 'offered' }, created_at: pkt(5, 10),
};

function seed(language) {
  return {
    users: [{ id: T, phone_number: PHONE, preferred_language: language, role: 'teacher' }],
    niete_lp_assets: [A_MATH],
    niete_lp_asset_sources: [{
      asset_id: A_MATH.id, lesson_id: A_MATH.lesson_id, version_stamp: A_MATH.version_stamp, content_hash: A_MATH.content_hash, verified: 'upload', slide_script: {},
    }],
    niete_lp_downloads: [{
      id: 'd-math', user_id: T, lesson_id: A_MATH.lesson_id, asset_id: A_MATH.id, version_stamp: A_MATH.version_stamp,
      content_hash: A_MATH.content_hash, status: 'sent', grade: 4, subject: 'math', created_at: pkt(2, 9),
    }],
    coaching_sessions: [REC],
    quizzes: [OFFERED],
    quiz_sessions: [],
    teacher_nudges: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
});

describe.each(['en', 'ur'])('one phrase for "no quiz yet" (%s)', (language) => {
  test('the Flow: an un-made lesson plan and an offered-but-unanswered recording read the same', async () => {
    mockDb = makeDb(seed(language));
    const res = await Endpoint.handleTranscriptQuizInit(TOKEN);
    expect(res.screen).toBe('LESSONS');
    const byId = Object.fromEntries(res.data.items.map((i) => [i.id, i['main-content'].description]));
    expect(byId['lsn_lp_v8_d-math']).toBeTruthy();
    expect(byId['cs-1']).toBeTruthy();
    expect(byId['cs-1']).toBe(byId['lsn_lp_v8_d-math']);
  });

  test('the list message: the same two rows end in the same status words', async () => {
    mockDb = makeDb(seed(language));
    await List.showList({ id: T, preferred_language: language }, PHONE, language, 1);
    const payload = WhatsAppService.sendInteractiveMessage.mock.calls[0][1];
    const rows = payload.action.sections[0].rows;
    const statusOf = (row) => row.description.split(' · ').pop();
    const lp = rows.find((r) => r.id.includes('d-math'));
    const rec = rows.find((r) => r.id.includes('cs-1'));
    expect(lp && rec).toBeTruthy();
    // The recorded lesson's status is the words of a lesson with no quiz at all.
    const none = List.statusLine(null, language);
    expect(statusOf(rec)).toBe(none);
    // The lesson-plan row says the same — where the 72-code-point field has room
    // for a status after its label and topic (a long topic keeps the topic and
    // drops the status: composeLabelledDescription).
    if (lp.description.split(' · ').length === 3) expect(statusOf(lp)).toBe(none);
  });
});
