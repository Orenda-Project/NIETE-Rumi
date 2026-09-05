'use strict';
/**
 * bd-mg9c7 — the edits to EXISTING files. Each test executes the changed
 * line on its live branch (root rule 6); the source greps at the end only
 * pin the places a unit test cannot load (the webhook router, the worker
 * switch).
 */
const fs = require('fs');
const path = require('path');
const src = (p) => fs.readFileSync(path.join(__dirname, '..', '..', 'bot', p), 'utf8');

// ─── 1. report-generator: the dead Trigger 3 is replaced by the offer ───────
describe('report-generator → transcript quiz offer', () => {
  beforeEach(() => jest.resetModules());

  test('scheduleTranscriptQuiz hands the session to the offer service and reports whether it scheduled', async () => {
    jest.doMock('../../bot/shared/services/quiz/transcript-quiz-offer.service', () => ({
      scheduleOffer: jest.fn().mockResolvedValue(true),
    }));
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    const Offer = require('../../bot/shared/services/quiz/transcript-quiz-offer.service');
    const RG = require('../../bot/shared/services/coaching/report-generator.service');
    const session = { user_id: 'u-1', transcript_text: 'x'.repeat(2000), users: { phone_number: '923001234567' } };
    const scheduled = await RG.scheduleTranscriptQuiz(session, 'cs-1', '923001234567', 'ur');
    expect(scheduled).toBe(true);
    expect(Offer.scheduleOffer).toHaveBeenCalledWith(expect.objectContaining({
      coachingSessionId: 'cs-1', userId: 'u-1', phone: '923001234567', language: 'ur', transcriptChars: 2000, source: 'self',
    }));
  });

  test('a throwing offer service never fails the report', async () => {
    jest.doMock('../../bot/shared/services/quiz/transcript-quiz-offer.service', () => ({
      scheduleOffer: jest.fn().mockRejectedValue(new Error('boom')),
    }));
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    const RG = require('../../bot/shared/services/coaching/report-generator.service');
    await expect(RG.scheduleTranscriptQuiz({ user_id: 'u' }, 'cs', 'p', 'en')).resolves.toBe(false);
  });

  test('generateReport no longer calls the dead Trigger 3 and skips the feature-link ask when an offer was scheduled', () => {
    const s = src('shared/services/coaching/report-generator.service.js');
    expect(s).not.toMatch(/await this\.offerQuizAfterReport\(/);
    expect(s).toMatch(/skipFeatureLink = await this\.scheduleTranscriptQuiz\(/);
    expect(s).toMatch(/if \(!skipFeatureLink\)[\s\S]{0,400}FeatureLinkerService\.suggestNext\(/);
  });
});

// ─── 2. survey answer brings the offer forward ───────────────────────────────
describe('coaching survey answer triggers the offer early', () => {
  beforeEach(() => jest.resetModules());
  test('handleFeedbackButton calls triggerEarly with the session id', async () => {
    jest.doMock('../../bot/shared/config/supabase', () => {
      const { fromMock } = require('./helpers/supabase-chain');
      return { from: fromMock({ coaching_sessions: { data: [{ id: 'cs', user_id: 'u' }] }, users: { data: [{ preferred_language: 'en' }] }, coaching_quality_metrics: { data: [] } }) };
    });
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn() }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn().mockResolvedValue(true), sendInteractiveButtons: jest.fn() }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/services/quiz/transcript-quiz-offer.service', () => ({ triggerEarly: jest.fn().mockResolvedValue(true) }));
    const Offer = require('../../bot/shared/services/quiz/transcript-quiz-offer.service');
    const Fb = require('../../bot/shared/services/coaching/coaching-feedback.service');
    const id = '11111111-1111-4111-8111-111111111111';
    await Fb.handleFeedbackButton(`coaching_fb_yes_${id}`, '923001234567');
    expect(Offer.triggerEarly).toHaveBeenCalledWith(id);
  });
});

// ─── 3. no lesson video for a transcript quiz ────────────────────────────────
describe('video-quiz startSession without a video', () => {
  beforeEach(() => jest.resetModules());
  test('a share_link session with video_id null never queries student_videos', async () => {
    const { fromMock } = require('./helpers/supabase-chain');
    const from = fromMock({
      quiz_questions: { data: [{ id: 'q1', external_id: 'tq:S1:1', sort_order: 0 }] },
      quiz_sessions: { data: [{ id: 'sess' }] },
      quiz_share_codes: { data: [] },
      student_videos: { data: [] },
    });
    jest.doMock('../../bot/shared/config/supabase', () => ({ from, rpc: jest.fn().mockResolvedValue({ error: null }) }));
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({ get: jest.fn(), set: jest.fn().mockResolvedValue(true), delete: jest.fn() }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn().mockResolvedValue(true), sendVideoFromUrl: jest.fn() }));
    jest.doMock('../../bot/shared/services/quiz/video-quiz-sender.service', () => ({ sendPhase: jest.fn().mockResolvedValue({ pickerFailed: false }) }));
    jest.doMock('../../bot/shared/services/quiz/video-quiz-rate-limiter.service', () => ({ throttle: jest.fn().mockResolvedValue(undefined) }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
    const VQ = require('../../bot/shared/services/quiz/video-quiz.service');
    const WA = require('../../bot/shared/services/whatsapp.service');
    await VQ.startSession({ phone: '923001234567', userId: null, quizId: 'qz', videoId: null, language: 'ur', source: 'share_link', studentName: 'Ali', shareCodeId: 'sc' });
    expect(from.mock.calls.map((c) => c[0])).not.toContain('student_videos');
    expect(WA.sendVideoFromUrl).not.toHaveBeenCalled();
    // The opener is in the QUIZ language.
    expect(WA.sendMessage.mock.calls[0][1]).toMatch(/[؀-ۿ]/);
  });
});

// ─── 4. ack-first join ───────────────────────────────────────────────────────
describe('beginFromCodeLocked', () => {
  beforeEach(() => jest.resetModules());
  test('holds a per-phone+code lock so a Meta retry cannot start a second join', async () => {
    const setNX = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({ get: jest.fn(), set: jest.fn(), delete: jest.fn(), setNX }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn().mockResolvedValue(true) }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
    const Share = require('../../bot/shared/services/quiz/video-quiz-share.service');
    const begin = jest.spyOn(Share, 'beginFromCode').mockResolvedValue(true);
    await Share.beginFromCodeLocked('923001234567', 'ABC234');
    await Share.beginFromCodeLocked('923001234567', 'ABC234');
    expect(setNX).toHaveBeenCalledTimes(2);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  test('the text handler returns before the join resolves', () => {
    const s = src('shared/handlers/text-message.handler.js');
    expect(s).toMatch(/setImmediate\(\(\) => VideoQuizShare\.beginFromCodeLocked\(from, code\)/);
    expect(s).not.toMatch(/await VideoQuizShare\.beginFromCode\(from, code\)/);
  });
});

// ─── 5. sender throttle + chrome: tests/quiz/transcript-quiz-sender.test.js ──

// ─── 6. report: NIETE palette + SLO on the hardest cards ─────────────────────
describe('class report', () => {
  test('template uses the NIETE palette and never the Rumi navy', () => {
    const s = src('shared/templates/video-quiz-report.template.js');
    expect(s).toMatch(/#333748/);
    expect(s).not.toMatch(/#0c1a4e/);
  });

  test('the hardest-question card carries the SLO statement when the quiz has a digest', () => {
    jest.resetModules();
    const render = require('../../bot/shared/templates/video-quiz-report.template');
    const html = render({
      topic: 'کسریں', language: 'ur', started: 3, finished: 3, average: 50,
      students: [], hardest: [{ question_text: 'q', wrong: 2, total: 3, slo: 'آدھے کو کسر میں لکھنا' }], unfinished: [],
    });
    expect(html).toMatch(/آدھے کو کسر میں لکھنا/);
  });

  test('generate() attaches the SLO from quizzes.meta.digest to each hardest question', () => {
    const s = src('shared/services/quiz/video-quiz-report.service.js');
    expect(s).toMatch(/meta\??\.digest/);
    expect(s).toMatch(/slo:/);
  });
});

// ─── 7. the parts a unit test cannot load ────────────────────────────────────
describe('routing and worker wiring', () => {
  test('whatsapp-bot routes tq_ buttons and tq_pick_ list rows', () => {
    const s = src('whatsapp-bot.js');
    expect(s).toMatch(/buttonId\.startsWith\('tq_'\)/);
    expect(s).toMatch(/listId\.startsWith\('tq_pick_'\)/);
  });

  test('the worker consumes quiz_offer, quiz_generate and quiz_nudge_teacher', () => {
    const s = src('workers/sqs-worker.js');
    expect(s).toMatch(/case 'quiz_offer':/);
    expect(s).toMatch(/case 'quiz_generate':/);
    expect(s).toMatch(/case 'quiz_nudge_teacher':/);
  });

  test('/quiz reaches the transcript list when the flag is on, the old orchestrator otherwise', () => {
    const s = src('shared/handlers/text-message.handler.js');
    expect(s).toMatch(/TranscriptQuizList\.isQuizCommand\(trimmedMessage\)/);
    expect(s).toMatch(/TranscriptQuizList\.showList\(/);
    expect(s).toMatch(/QuizOrchestrator\.initiateQuizRequest\(/);
  });

  test('sendVideoWithButtons exists and sends a video header', () => {
    const s = src('shared/services/whatsapp.service.js');
    expect(s).toMatch(/static async sendVideoWithButtons\(to, videoUrl, bodyText, buttons\)/);
    expect(s).toMatch(/type: 'video',\s*video: videoHeader/);
  });
});
