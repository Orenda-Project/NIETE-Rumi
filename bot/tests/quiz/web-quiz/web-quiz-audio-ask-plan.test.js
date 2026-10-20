'use strict';
/**
 * One clip job per quiz from the start (app_settings `web_quiz_audio_ask_plan`, default OFF, JSON true only).
 * A quiz's clips are asked for when its link is minted (generation, web-quiz-link quizLink) or an old WhatsApp link is
 * redirected (web-quiz-old-link), and again when its page opens. The first two ask with no one-voice plan, so their
 * job id is `<quiz>-quiz_web_audio-v<N>`, while the page asks under the plan, `…-v<N>-one-<sig>`: the queue keeps both
 * and two workers record the same quiz at once. On: a request that names no plan asks under the live plan for that
 * quiz (as the page does), so the page's request is the same job and the queue drops it. Off: today's job ids.
 *
 * Boundaries faked: supabase (in-memory), the queue, the loggers.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const Publish = require('../../../shared/services/quiz/web-quiz-publish.service');
const OneVoice = require('../../../shared/services/quiz/web-quiz-one-voice-flag');
const AskPlan = require('../../../shared/services/quiz/web-quiz-audio-ask-plan');

const QUIZ = '33333333-3333-4333-8333-333333333333';
let n = 0;
function seed({ ask, oneVoice = true, quizId = QUIZ } = {}) {
  return makeFake({
    quizzes: [{ id: quizId, topic: 'Months', grade: '1', subject: 'English', language: 'en', meta: {}, quiz_source: 'video' }],
    app_settings: [
      ...(oneVoice ? [{ key: 'web_quiz_one_voice', value: true }] : []),
      ...(ask === undefined ? [] : [{ key: 'web_quiz_audio_ask_plan', value: ask }]),
    ],
  });
}
const dedupOf = (queue) => queue.queueJob.mock.calls.map((c) => c[3].deduplicationId);
// each test its own quiz id: requestQuizAudio remembers a request per process for 10 minutes
const fresh = () => `33333333-3333-4333-8333-${String(++n).padStart(12, '0')}`;

beforeEach(() => { OneVoice.reset(); AskPlan._resetCache(); });

describe('web_quiz_audio_ask_plan on: the link and the page ask for the same job', () => {
  test('a request that names no plan (the minted link) asks under the live plan, as the page does', async () => {
    const quizId = fresh();
    const fake = seed({ ask: true, quizId });
    const db = { from: fake.from };
    const queue = { queueJob: jest.fn(async () => ({})) };
    await Publish.requestQuizAudio(quizId, { queue, db });
    const sig = OneVoice.normalize(true).sig;
    expect(dedupOf(queue)).toEqual([`${quizId}-quiz_web_audio-v${Publish.AUDIO_VERSION}-one-${sig}`]);
    // the page's own request in this process is the same request: not queued again
    await Publish.requestQuizAudio(quizId, { meta: {}, queue, db, oneVoice: OneVoice.forQuiz(await OneVoice.plan({ db }), quizId, 'en') });
    expect(queue.queueJob).toHaveBeenCalledTimes(1);
  });

  test('a quiz already recorded under the plan is not queued by the link', async () => {
    const quizId = fresh();
    const fake = seed({ ask: true, quizId });
    const db = { from: fake.from };
    const queue = { queueJob: jest.fn(async () => ({})) };
    const sig = OneVoice.normalize(true).sig;
    await Publish.requestQuizAudio(quizId, { meta: { web_one: { audio_v: Publish.AUDIO_VERSION, audio_voice: 'sx-x', audio_one: sig } }, queue, db });
    expect(queue.queueJob).not.toHaveBeenCalled();
  });

  test('one voice off: the link asks as today', async () => {
    const quizId = fresh();
    const fake = seed({ ask: true, oneVoice: false, quizId });
    const queue = { queueJob: jest.fn(async () => ({})) };
    await Publish.requestQuizAudio(quizId, { queue, db: { from: fake.from } });
    expect(dedupOf(queue)).toEqual([`${quizId}-quiz_web_audio-v${Publish.AUDIO_VERSION}`]);
  });
});

describe('web_quiz_audio_ask_plan off (absent, false, or "true" as a string): job ids as today', () => {
  test.each([[undefined], [false], ['true']])('value %p', async (value) => {
    const quizId = fresh();
    const fake = seed({ ask: value, quizId });
    const queue = { queueJob: jest.fn(async () => ({})) };
    await Publish.requestQuizAudio(quizId, { queue, db: { from: fake.from } });
    expect(dedupOf(queue)).toEqual([`${quizId}-quiz_web_audio-v${Publish.AUDIO_VERSION}`]);
  });
});

// The page has already resolved the one-voice plan (planKnown): it never reads this switch, so a class page makes no
// settings read it did not make before the switch existed (the page read budget, web-quiz-one-voice-page-reads).
describe('the page (planKnown): no read of this switch', () => {
  test.each([[true], [undefined]])('switch %p: no app_settings read of web_quiz_audio_ask_plan, job id as asked', async (ask) => {
    const quizId = fresh();
    const fake = seed({ ask, oneVoice: false, quizId });
    const keys = [];
    const db = { from: (t) => { const q = fake.from(t); if (t !== 'app_settings') return q; const eq = q.eq.bind(q); q.eq = (c, v) => { if (c === 'key') keys.push(v); return eq(c, v); }; return q; } };
    const queue = { queueJob: jest.fn(async () => ({})) };
    await Publish.requestQuizAudio(quizId, { meta: {}, queue, db, planKnown: true });
    expect(keys).not.toContain(AskPlan.KEY);
    expect(dedupOf(queue)).toEqual([`${quizId}-quiz_web_audio-v${Publish.AUDIO_VERSION}`]);
  });
});
