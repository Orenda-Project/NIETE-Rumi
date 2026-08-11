'use strict';
/**
 * bd-2338 — a new child gives their name and class in one Flow screen, once.
 *
 * Two sequential free-text questions cost a child three round trips before
 * question 1. A Flow collects both at once, validates them, and matches how
 * registration already works.
 *
 * The behaviour that matters is WHEN it appears: only for a child we have never
 * met. A returning child (bd-2337) never sees it, which is the whole point of
 * remembering them.
 *
 * The failure this guards against is the one the video-quiz handover documents:
 * a Flow whose footer is `data_exchange` renders perfectly and silently swallows
 * everything, because nfm_reply only fires when the Flow terminates on the
 * client. So the fallback path matters too — with no Flow configured, the child
 * must still be able to join by typing.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn().mockResolvedValue(true), delete: jest.fn(),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/student-identity.service', () => ({
  findByPhone: jest.fn().mockResolvedValue([]),
  remember: jest.fn().mockResolvedValue({ id: 'stu-1' }),
  touch: jest.fn().mockResolvedValue(undefined),
  normalisePhone: (p) => String(p || '').replace(/\D/g, ''),
}));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const StudentIdentity = require('../../shared/services/quiz/student-identity.service');
const share = require('../../shared/services/quiz/video-quiz-share.service');

const SHARE_CODE = {
  id: 'sc-1', quiz_id: 'q1', video_id: 'v1', teacher_user_id: 'u1',
  teacher_name: 'Miss Ayesha', topic: 'A Balanced Diet', language: 'en',
  active: true, expires_at: null,
};

function stubShareCodeLookup() {
  const supabase = require('../../shared/config/supabase');
  supabase.from.mockImplementation((table) => {
    const orderable = {
      order: () => orderable,
      then: (resolve) => resolve({
        data: [{ id: 'q1', external_id: 'leg:1', sort_order: 1 }], error: null,
      }),
    };
    const chain = {
      select: () => chain, eq: () => chain, update: () => chain,
      in: () => chain, limit: () => chain,
      // startSession chains TWO .order() calls, so this has to be both
      // chainable and awaitable. Without it the chain breaks inside
      // startSession rather than in anything this file is testing.
      order: () => orderable,
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'sess-1' } }) }) }),
      // sendNextQuestion fetches the first question by id.
      single: async () => ({
        data: {
          id: 'q1', question_text: 'Which one?', option_a: 'A', option_b: 'B',
          option_c: null, option_d: null, correct_option: 'A',
          media: {}, render_pattern: 'P1',
        },
        error: null,
      }),
      maybeSingle: async () => ({ data: SHARE_CODE }),
    };
    return chain;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  StudentIdentity.findByPhone.mockResolvedValue([]);
  stubShareCodeLookup();
});

describe('bd-2338 — a child we have never met gets the Flow', () => {
  const OLD = process.env.STUDENT_JOIN_FLOW_ID;
  beforeEach(() => { process.env.STUDENT_JOIN_FLOW_ID = '1532657468345114'; });
  afterEach(() => { process.env.STUDENT_JOIN_FLOW_ID = OLD; });

  test('the Flow is sent instead of asking for a name in chat', async () => {
    await share.beginFromCode('923001234567', 'K7RM2');

    expect(WhatsAppService.sendFlow).toHaveBeenCalled();
    const [, opts] = WhatsAppService.sendFlow.mock.calls[0];
    // Routed on our own token, not guessed from the payload shape.
    expect(opts.flowToken).toBe('vqjoin:sc-1');
    // The child sees whose quiz this is before typing anything.
    expect(opts.navigateData.teacher).toBe('Miss Ayesha');
    expect(opts.navigateData.topic).toBe('A Balanced Diet');
  });

  test('a child we already know never sees it', async () => {
    StudentIdentity.findByPhone.mockResolvedValue([
      { id: 's1', student_name: 'Hooria', self_reported_class: '3-B' },
    ]);
    await share.beginFromCode('923001234567', 'K7RM2');
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
  });
});

describe('bd-2338 — with no Flow configured the child can still join', () => {
  const OLD = process.env.STUDENT_JOIN_FLOW_ID;
  beforeEach(() => { delete process.env.STUDENT_JOIN_FLOW_ID; });
  afterEach(() => { process.env.STUDENT_JOIN_FLOW_ID = OLD; });

  test('it falls back to asking in chat rather than dead-ending', async () => {
    await share.beginFromCode('923001234567', 'K7RM2');
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    const bodies = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
    expect(bodies.some((b) => /what is your name/i.test(b))).toBe(true);
  });
});

describe('bd-2338 — the submission starts the quiz', () => {
  test('a Flow reply is accepted and remembers the child', async () => {
    const handled = await share.handleJoinFlowReply('923001234567', 'vqjoin:sc-1', {
      student_name: 'Hooria', student_class: 'Grade 3',
    });
    expect(handled).toBe(true);
    expect(StudentIdentity.remember).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Hooria', className: 'Grade 3',
    }));
  });

  test('a token that is not ours is left alone', async () => {
    const handled = await share.handleJoinFlowReply('923001234567', 'vq:sess:q1', {
      student_name: 'Hooria',
    });
    expect(handled).toBe(false);
    expect(StudentIdentity.remember).not.toHaveBeenCalled();
  });

  test('an empty name is refused rather than stored blank', async () => {
    const handled = await share.handleJoinFlowReply('923001234567', 'vqjoin:sc-1', {
      student_name: '   ', student_class: 'Grade 3',
    });
    expect(handled).toBe(true);               // ours, so we consumed it
    expect(StudentIdentity.remember).not.toHaveBeenCalled();
  });
});
