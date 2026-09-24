'use strict';
/**
 * The quiz funnel's one event shape: `quiz_funnel.<stage>`.
 *
 * Every stage of both quiz streams — a quiz born of a coaching recording and a
 * quiz born of a lesson plan — writes ONE event through ONE helper, so the whole
 * chain can be counted with one query: `where msg startswith 'quiz_funnel.'`,
 * grouped by stage and stream. Before it, the same chain was spread over
 * `transcript_quiz.*`, `lp_quiz.*` and `video_quiz.*`, with the stream missing
 * from half of them and `source` meaning three different things.
 *
 * What the helper must guarantee, because every caller relies on it:
 *   - a stage it does not know is refused, so a typo cannot mint a new event name;
 *   - only whitelisted fields reach Axiom, and only as ids, tokens, counts and
 *     booleans — a name or a message can never ride along (data standard D4);
 *   - it never throws: a log call must not be able to break the pipeline it watches.
 */
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { logEvent } = require('../../bot/shared/utils/structured-logger');
const Funnel = require('../../bot/shared/services/quiz/quiz-funnel');

const QID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => jest.clearAllMocks());

describe('the event name and the stages', () => {
  test('a known stage is written as quiz_funnel.<stage>', () => {
    expect(Funnel.emit('accepted', { quiz_id: QID, source: 'transcript', channel: 'coaching_offer' })).toBe(true);
    expect(logEvent).toHaveBeenCalledWith('quiz_funnel.accepted', { quiz_id: QID, source: 'transcript', channel: 'coaching_offer' });
  });

  test('every stage of the chain is known, in order', () => {
    expect(Funnel.STAGES).toEqual([
      'offer_made', 'offer_answered', 'accepted', 'generation_started', 'generated', 'generation_failed',
      'sent', 'send_failed', 'child_joined', 'child_completed', 'scorecard_sent', 'class_cards',
      'report_sent', 'report_failed',
    ]);
  });

  test('an unknown stage is refused and nothing is logged', () => {
    expect(Funnel.emit('acepted', { quiz_id: QID })).toBe(false);
    expect(logEvent).not.toHaveBeenCalled();
  });
});

describe('only ids, tokens, counts and booleans reach Axiom', () => {
  test('a field outside the whitelist is dropped — a name cannot ride along', () => {
    Funnel.emit('child_completed', {
      quiz_id: QID, source: 'transcript', student_name: 'Some Child', takerName: 'Some Child', phone: '923001234567',
    });
    const [, data] = logEvent.mock.calls[0];
    expect(data).toEqual({ quiz_id: QID, source: 'transcript' });
  });

  test('a reason that is not a token (free text, an error message) is replaced, never forwarded', () => {
    Funnel.emit('generation_failed', { quiz_id: QID, reason: 'quizzes update failed: column "x" of Ali Khan' });
    expect(logEvent.mock.calls[0][1].reason).toBe('other');
    Funnel.emit('generation_failed', { quiz_id: QID, reason: 'validator_failed' });
    expect(logEvent.mock.calls[1][1].reason).toBe('validator_failed');
  });

  test('an id that is not an id is dropped', () => {
    Funnel.emit('sent', { quiz_id: 'Ali Khan', teacher_id: QID });
    expect(logEvent.mock.calls[0][1]).toEqual({ teacher_id: QID });
  });

  test('counts are numbers and booleans are booleans', () => {
    Funnel.emit('report_sent', { quiz_id: QID, n: '7', ok: 1, pdf_sent: 0, link_sent: 'yes', failed: 'x' });
    expect(logEvent.mock.calls[0][1]).toEqual({ quiz_id: QID, n: 7, ok: true, pdf_sent: false, link_sent: true });
  });

  test('null and undefined fields are left out rather than logged as empty', () => {
    Funnel.emit('offer_made', { quiz_id: QID, nudge_id: null, teacher_id: undefined, source: 'transcript' });
    expect(logEvent.mock.calls[0][1]).toEqual({ quiz_id: QID, source: 'transcript' });
  });
});

describe('it never throws', () => {
  test('a logger that throws is swallowed, and emit says it did not log', () => {
    logEvent.mockImplementationOnce(() => { throw new Error('pino down'); });
    let out;
    expect(() => { out = Funnel.emit('accepted', { quiz_id: QID }); }).not.toThrow();
    expect(out).toBe(false);
    expect(Funnel.emit('accepted', { quiz_id: QID })).toBe(true);
  });

  test('no fields at all is still a valid event', () => {
    expect(Funnel.emit('generation_started')).toBe(true);
    expect(logEvent).toHaveBeenCalledWith('quiz_funnel.generation_started', {});
  });
});

describe('the channel a quiz was born on, from the row\'s meta.source', () => {
  test.each([
    ['self', 'coaching_offer'],     // the offer after a self-coaching report (scheduleOffer default)
    ['offer', 'coaching_offer'],    // the same offer, older rows
    ['lp_offer', 'lp_offer'],       // the afternoon lesson-plan offer
    ['list', 'quiz_menu'],          // /quiz, the list message
    ['flow', 'quiz_menu'],          // /quiz, the Flow
    ['remake', 'remake'],
  ])('%s → %s', (metaSource, channel) => {
    expect(Funnel.channelOf(metaSource)).toBe(channel);
  });

  test('an unknown or missing source is "unknown", never a guess', () => {
    expect(Funnel.channelOf(undefined)).toBe('unknown');
    expect(Funnel.channelOf('something_new')).toBe('unknown');
  });
});

describe('the stream a quiz belongs to', () => {
  test.each([
    ['transcript', 'transcript'],
    ['lp_v8', 'lp'],
    ['lp612', 'lp'],       // a 6-12 lesson-plan quiz counts with the lesson-plan stream
    ['video', null],       // the video-lesson quiz shares the child engine and is NOT one of the two streams
    [undefined, null],
  ])('%s → %s', (source, stream) => {
    expect(Funnel.streamOf(source)).toBe(stream);
  });
});
