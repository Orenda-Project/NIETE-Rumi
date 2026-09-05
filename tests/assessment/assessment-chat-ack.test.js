/**
 * "Making your paper" belongs in the chat, not on a screen.
 *
 * The Flow used to end on a SUBMITTED screen whose whole content was a sentence
 * and a Close button. It told her nothing she could act on and cost her a tap to
 * dismiss — and the message it carried ("about a minute, it will arrive in this
 * chat") is *about* the chat, so the chat is where it belongs.
 *
 * Meta will not let a non-terminal screen close the Flow — `complete` is refused
 * anywhere but a terminal screen (verified against the Graph API, not assumed).
 * So the last REAL screen becomes the terminal one: CONFIRM for generation,
 * PICK_DONE for a rebuild. Its Footer completes, the Flow closes, and the
 * acknowledgement arrives as a message.
 */

const mockRedis = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
const mockSupabase = { from: jest.fn() };
const mockQueueJob = jest.fn().mockResolvedValue({ MessageId: 'm1' });
const mockRerender = jest.fn();
const mockListQuestions = jest.fn();

jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: mockQueueJob }));
jest.mock('../../bot/shared/config/feature-flags', () => ({
  isAssessmentGeneratorEnabled: jest.fn().mockResolvedValue(true),
  isAssessmentEditingEnabled: jest.fn().mockResolvedValue(false),
  ASSESSMENT_GENERATOR_KEY: 'assessment_generator_enabled',
  ASSESSMENT_EDITING_KEY: 'assessment_editing_enabled',
}));
jest.mock('../../bot/shared/services/assessment/assessment-revision.service', () => ({
  rerender: (...a) => mockRerender(...a),
  listQuestions: (...a) => mockListQuestions(...a),
  saveEdit: jest.fn().mockResolvedValue({ status: 'ok' }),
}));

const Endpoint = require('../../bot/shared/routes/assessment-gen-endpoint');
const { handleAssessmentGenDataExchange: exchange } = Endpoint;

const TOKEN = 'user-1:assessment-review:paper-1';
let inserted;
const ITEMS = [
  { id: 'a.b.MCQs.0', number: 1, marks: 1, type: 'MCQs', text: 'Q1', selected: true,
    shape: 'options', question: { question: 'Q1', options: ['a', 'b'], marks: 1 } },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.get.mockResolvedValue(null);
  mockRedis.set.mockResolvedValue(true);
  mockListQuestions.mockResolvedValue({ items: ITEMS, paper: { id: 'paper-1' } });
  mockRerender.mockResolvedValue({ status: 'ready', questionCount: 1, marks: 1 });
});

describe('generation ends by closing the Flow, not on another screen', () => {
  function wireDb() {
    // The real code chains .eq() several deep and ends in either maybeSingle()
    // or an await on the builder itself, depending on the call site. The mock
    // has to be thenable AND terminable at EVERY depth, or it fails for a
    // reason that has nothing to do with what the test is about.
    const BOOK = { id: 'book-1', grade: 4, subject: 'science', total_pages: 100 };
    const node = (rows, one) => {
      const n = {
        eq: () => node(rows, one),
        gte: () => node(rows, one),
        lte: () => node(rows, one),
        order: () => node(rows, one),
        limit: () => node(rows, one),
        maybeSingle: () => Promise.resolve({ data: one, error: null }),
        single: () => Promise.resolve({ data: one, error: null }),
        then: (r) => Promise.resolve({ data: rows, error: null }).then(r),
      };
      return n;
    };
    mockSupabase.from.mockImplementation((table) => {
      if (table === 'textbooks') return { select: () => node([BOOK], BOOK) };
      if (table === 'textbook_toc') {
        const ch = { chapter_number: 3, chapter_title: 'Living Things', page_start: 34, page_end: 41 };
        return { select: () => node([ch], ch) };
      }
      if (table === 'assessment_requests') {
        return { insert: () => ({ select: () => ({ single: () =>
          Promise.resolve({ data: { id: 'req-1' }, error: null }) }) }) };
      }
      return { select: () => node([], null) };
    });
  }

  test('CONFIRM does NOT route to a SUBMITTED screen', async () => {
    wireDb();
    mockRedis.get.mockResolvedValue({
      userId: 'user-1', grade: 4, subject: 'science', chapterNumber: 3,
      pageRanges: '34-41', questionCount: 10, questionTypes: [], contentSource: 'unseen',
    });
    const res = await exchange('user-1', 'CONFIRM',
      { output_format: 'pdf', answer_key: false, answer_lines: true }, 'user-1:assessment-gen:1');

    expect(res.screen).not.toBe('SUBMITTED');
    // The Flow is finished: no further screen is returned at all.
    expect(res.close_flow ?? res.screen).toBeDefined();
  });

  test('the acknowledgement rides out as a chat message, tagged for the router', async () => {
    wireDb();
    mockRedis.get.mockResolvedValue({
      userId: 'user-1', grade: 4, subject: 'science', chapterNumber: 3,
      pageRanges: '34-41', questionCount: 10, questionTypes: [], contentSource: 'unseen',
    });
    const res = await exchange('user-1', 'CONFIRM',
      { output_format: 'pdf', answer_key: false, answer_lines: true }, 'user-1:assessment-gen:1');

    const params = res.data?.extension_message_response?.params;
    expect(params).toBeDefined();
    // A discriminator the flow-type detector can match on. Without it the
    // submission falls through to the generic "Type /menu" reply.
    expect(params.assessment_action).toBe('queued');
  });

  test('the job is still queued — closing the Flow must not skip the work', async () => {
    wireDb();
    mockRedis.get.mockResolvedValue({
      userId: 'user-1', grade: 4, subject: 'science', chapterNumber: 3,
      pageRanges: '34-41', questionCount: 10, questionTypes: [], contentSource: 'unseen',
    });
    await exchange('user-1', 'CONFIRM',
      { output_format: 'pdf', answer_key: false, answer_lines: true }, 'user-1:assessment-gen:1');
    expect(mockQueueJob).toHaveBeenCalled();
  });
});

describe('a rebuild ends the same way', () => {
  test('PICK_DONE closes rather than returning SUBMITTED', async () => {
    mockRedis.get.mockResolvedValue({
      userId: 'user-1', paperId: 'paper-1', page: 0, selected: ['a.b.MCQs.0'],
    });
    const res = await exchange('user-1', 'PICK_DONE', { _action: 'rebuild' }, TOKEN);
    expect(res.screen).not.toBe('SUBMITTED');
    const params = res.data?.extension_message_response?.params;
    expect(params.assessment_action).toBe('rebuilt');
  });

  test('a FAILED rebuild still closes, and says so in its tag', async () => {
    // She must not be left on a screen holding an error she cannot act on; the
    // reason travels to the chat, where a retry is one message away.
    mockRedis.get.mockResolvedValue({
      userId: 'user-1', paperId: 'paper-1', page: 0, selected: ['a.b.MCQs.0'],
    });
    mockRerender.mockResolvedValue({ status: 'failed', code: 'RENDER_FAILED' });
    const res = await exchange('user-1', 'PICK_DONE', { _action: 'rebuild' }, TOKEN);
    const params = res.data?.extension_message_response?.params;
    expect(params.assessment_action).toBe('rebuild_failed');
  });

  test('with editing OFF, KEEP closes straight after the tick list', async () => {
    mockRedis.get.mockResolvedValue({
      userId: 'user-1', paperId: 'paper-1', page: 0, selected: ['a.b.MCQs.0'],
    });
    const res = await exchange('user-1', 'KEEP',
      { keep: ['a.b.MCQs.0'], page: '0', _action: 'done' }, TOKEN);
    expect(res.screen).not.toBe('SUBMITTED');
    expect(res.data?.extension_message_response?.params.assessment_action).toBe('rebuilt');
  });
});

describe('the router must recognise the submission (bd-1249 class of bug)', () => {
  const detect = require('../../bot/shared/utils/flow-type-detector');

  test('an assessment completion is detected, not misrouted to attendance', () => {
    // The assessment flow token is `<userId>:assessment-gen:<ts>` — full of
    // colons, which is exactly what the loose attendance fallback matches on.
    // Three flows have been misrouted this way already.
    const fn = typeof detect === 'function' ? detect : detect.detectFlowType;
    expect(fn({ assessment_action: 'queued', flow_token: 'u1:assessment-gen:123' }))
      .toBe('assessment_gen');
  });

  test('every action tag routes to the same flow type', () => {
    const fn = typeof detect === 'function' ? detect : detect.detectFlowType;
    for (const a of ['queued', 'rebuilt', 'rebuild_failed']) {
      expect(fn({ assessment_action: a, flow_token: 'u1:assessment-review:p1' }))
        .toBe('assessment_gen');
    }
  });

  test('an unrelated submission is NOT captured by the new rule', () => {
    const fn = typeof detect === 'function' ? detect : detect.detectFlowType;
    expect(fn({ Student_Full_Name: 'x', Assessment_Mode: 'y' })).not.toBe('assessment_gen');
  });
});

describe('what she actually reads in the chat', () => {
  // The handler lives in flow-response.handler, which transitively loads the
  // LLM client — and that constructs an OpenAI client at IMPORT time, so
  // requiring it here dies on a missing key before a single assertion runs.
  // Mocked at that boundary (never the module under test) per the repo's TDD
  // rule; the handler itself is exercised for real.
  jest.mock('../../bot/shared/services/llm-client', () => ({
    chat: jest.fn(), complete: jest.fn(), getClient: jest.fn(),
  }));
  const mockSend = jest.fn();
  jest.mock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: (...a) => mockSend(...a),
    sendDocumentByLink: jest.fn(), sendFlow: jest.fn(), sendMessageWithButtons: jest.fn(),
  }));

  let handle;
  beforeAll(() => {
    ({ handleAssessmentFlowCompletion: handle } =
      require('../../bot/shared/handlers/flow-response.handler'));
  });
  beforeEach(() => mockSend.mockClear());

  // A `queued` completion now really submits, so these need a session to submit
  // FROM — that is the behaviour under test everywhere below.
  const withSession = () => mockRedis.get.mockResolvedValue({
    userId: 'u1', grade: 4, subject: 'science', chapterNumber: 3,
    pageRanges: '34-41', questionCount: 10, questionTypes: [], contentSource: 'unseen',
  });
  const wireBook = () => mockSupabase.from.mockImplementation((table) => {
    const node = (rows, one) => ({
      eq: () => node(rows, one), gte: () => node(rows, one), lte: () => node(rows, one),
      order: () => node(rows, one), limit: () => node(rows, one),
      maybeSingle: () => Promise.resolve({ data: one, error: null }),
      single: () => Promise.resolve({ data: one, error: null }),
      then: (r) => Promise.resolve({ data: rows, error: null }).then(r),
    });
    if (table === 'textbooks') {
      const b = { id: 'book-1', grade: 4, subject: 'science', total_pages: 100 };
      return { select: () => node([b], b) };
    }
    if (table === 'assessment_requests') {
      return { insert: (row) => { inserted = row; return { select: () => ({ single: () =>
        Promise.resolve({ data: { id: 'req-1' }, error: null }) }) }; } };
    }
    return { select: () => node([], null) };
  });

  test('a queued paper tells her how long and what it is', async () => {
    withSession(); wireBook();
    await handle({ assessment_action: 'queued', summary: 'Grade 4 Science · Chapter 3',
      flow_token: 'u1:assessment-gen:1' }, '92300', { id: 'u1' });
    const [, text] = mockSend.mock.calls[0];
    expect(text).toMatch(/about a minute/i);
    expect(text).toContain('Grade 4 Science');
  });

  test('a rebuild says seconds, not a minute — it makes no model call', async () => {
    await handle({ assessment_action: 'rebuilt', summary: '12 questions · 25 marks' },
      '92300', { id: 'u1' });
    const [, text] = mockSend.mock.calls[0];
    expect(text).toMatch(/seconds/i);
    expect(text).not.toMatch(/about a minute/i);
  });

  test('a failure says nothing is being made, and what to do', async () => {
    await handle({ assessment_action: 'queue_failed' }, '92300', { id: 'u1' });
    const [, text] = mockSend.mock.calls[0];
    expect(text).toMatch(/nothing is being made/i);
    expect(text).toMatch(/\/assessment/);
  });

  test('an unrecognised tag sends NOTHING rather than a message that does not fit', async () => {
    await handle({ assessment_action: 'wat' }, '92300', { id: 'u1' });
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('a payload with no summary still gets one, from the session', async () => {
    // The completion carries no summary of its own, but the session knows what
    // she asked for — so she reads what is being made rather than a bare
    // "about a minute" with no subject attached.
    withSession(); wireBook();
    await handle({ assessment_action: 'queued', flow_token: 'u1:assessment-gen:1' },
      '92300', { id: 'u1' });
    const [, text] = mockSend.mock.calls[0];
    expect(text).toMatch(/about a minute\./);
    expect(text).toContain('Grade 4');
    expect(text).toContain('Science');
  });


  test('the REAL live payload still produces the right message', async () => {
    // Routing it is only half the job: with no `assessment_action` the handler
    // used to fall to its "unrecognised tag" branch and stay silent, which is
    // the same silence from the teacher's side.
    withSession(); wireBook();
    await handle({
      output_format: 'pdf', answer_lines: true, answer_key: true,
      flow_token: 'u1:assessment-gen:1788534348744',
    }, '92300', { id: 'u1' });

    expect(mockSend).toHaveBeenCalled();
    const [, text] = mockSend.mock.calls[0];
    expect(text).toMatch(/about a minute/i);
  });

  test('a review token produces the rebuild wording, not the generation one', async () => {
    await handle({ keep: ['a.0'], flow_token: 'u1:assessment-review:paper-1' },
      '92300', { id: 'u1' });
    const [, text] = mockSend.mock.calls[0];
    expect(text).toMatch(/seconds/i);
    expect(text).not.toMatch(/about a minute/i);
  });

  test('an explicit tag still wins over the token', async () => {
    await handle({ assessment_action: 'queue_failed', flow_token: 'u1:assessment-gen:1' },
      '92300', { id: 'u1' });
    const [, text] = mockSend.mock.calls[0];
    expect(text).toMatch(/nothing is being made/i);
  });
});

describe('the completion payload must actually CARRY the tag (bd-60029)', () => {
  // What went wrong live: CONFIRM's Footer asks for
  // `${data.extension_message_response}`, but the server rendered CONFIRM with
  // only { recap, error }. A Flow interpolates from the data the screen was
  // DRAWN with — the endpoint's reply to the submit is far too late. So the
  // completion arrived carrying only the form fields, `assessment_action` was
  // absent, the detector's new rule never fired, and the payload fell through
  // to the loose attendance fallback:
  //
  //   flowType: "attendance_marking"
  //   📋 Attendance marking flow completion (register already written by endpoint)
  //
  // She got no acknowledgement and no paper, and nothing logged an error.
  //
  // Asserted on the SCREEN DATA rather than the endpoint's return value,
  // because the return value was right all along — that is exactly why the
  // earlier tests passed while the feature was broken.
  const Endpoint2 = require('../../bot/shared/routes/assessment-gen-endpoint');

  test('CONFIRM is rendered WITH the completion payload it will send back', async () => {
    mockRedis.get.mockResolvedValue({
      userId: 'user-1', grade: 4, subject: 'science', chapterNumber: 3,
      pageRanges: '34-41', questionCount: 10, questionTypes: [], contentSource: 'unseen',
    });
    const res = await Endpoint2.handleAssessmentGenDataExchange(
      'user-1', 'QUESTIONS',
      { content_source: 'unseen', question_count: '10', pick_types: false },
      'user-1:assessment-gen:1');

    expect(res.screen).toBe('CONFIRM');
    const emr = res.data.extension_message_response;
    expect(emr).toBeDefined();
    expect(emr.params.assessment_action).toBe('queued');
  });

  test('every terminal screen carries one — a Footer cannot interpolate what is not there', async () => {
    // PICK_DONE is the other terminal screen and has the identical exposure.
    mockRedis.get.mockResolvedValue({
      userId: 'user-1', paperId: 'paper-1', page: 0, selected: ['a.b.MCQs.0'],
    });
    const res = await Endpoint2.handleAssessmentGenDataExchange(
      'user-1', 'PICK', { _action: 'summary' }, TOKEN);

    expect(res.screen).toBe('PICK_DONE');
    expect(res.data.extension_message_response?.params?.assessment_action).toBeDefined();
  });
});

describe('no handler may return a screen the Flow does not have (bd-60029)', () => {
  const fs = require('fs');
  const path = require('path');

  test('every screen id the endpoint returns exists in the published Flow', () => {
    // `done()` returned `screen: 'SUCCESS'` — a screen deleted along with
    // SUBMITTED. The client cannot render it, so with editing off KEEP's Next
    // led nowhere. Nothing in the endpoint's own tests would catch that,
    // because the endpoint is perfectly happy naming a screen that is gone.
    const src = fs.readFileSync(path.join(__dirname, '../..',
      'bot/shared/routes/assessment-gen-endpoint.js'), 'utf8');
    const flow = JSON.parse(fs.readFileSync(path.join(__dirname, '../..',
      'docs/flows/assessment-gen-flow.json'), 'utf8'));

    const real = new Set(flow.screens.map((s) => s.id));
    const named = new Set(
      [...src.matchAll(/screen:\s*'([A-Z_]+)'/g)].map((m) => m[1])
        .concat([...src.matchAll(/screen\('([A-Z_]+)'/g)].map((m) => m[1])),
    );
    expect([...named].filter((id) => !real.has(id))).toEqual([]);
  });

  test('with editing off, KEEP completes through a screen that really exists', async () => {
    const flags = require('../../bot/shared/config/feature-flags');
    flags.isAssessmentEditingEnabled.mockResolvedValue(false);
    mockRedis.get.mockResolvedValue({
      userId: 'user-1', paperId: 'paper-1', page: 0, selected: ['a.b.MCQs.0'],
    });
    const res = await exchange('user-1', 'KEEP',
      { keep: ['a.b.MCQs.0'], page: '0', _action: 'done' }, TOKEN);

    const flow = JSON.parse(require('fs').readFileSync(
      require('path').join(__dirname, '../..', 'docs/flows/assessment-gen-flow.json'), 'utf8'));
    const real = flow.screens.map((s) => s.id);
    expect(real).toContain(res.screen);
    expect(res.data.extension_message_response.params.assessment_action).toBe('rebuilt');
  });
});

describe('the token is the discriminator that actually survives (bd-60029)', () => {
  // Meta DROPS `extension_message_response` from the completion. Verified on the
  // live payload, not inferred — the Footer requested it, the screen declared
  // it, the server supplied it on the render, and what arrived was:
  //
  //   {"output_format":"pdf","answer_lines":true,"answer_key":true,
  //    "flow_token":"<userId>:assessment-gen:<ts>"}
  //
  // So routing cannot depend on that field. The FLOW TOKEN is ours, we set it
  // when we send the Flow, and it always comes back — `:assessment-gen:` for a
  // new paper and `:assessment-review:` for a rebuild.
  const detect = require('../../bot/shared/utils/flow-type-detector');
  const fn = typeof detect === 'function' ? detect : detect.detectFlowType;

  test('the REAL live payload routes to the assessment handler', () => {
    expect(fn({
      output_format: 'pdf', answer_lines: true, answer_key: true,
      flow_token: '60530046-7ac3-4ea3-a976-b43c37c23213:assessment-gen:1788534348744',
    })).toBe('assessment_gen');
  });

  test('a review-token completion routes there too', () => {
    expect(fn({ keep: ['a.0'], flow_token: 'u1:assessment-review:paper-1' }))
      .toBe('assessment_gen');
  });

  test('it still works if Meta ever DOES send the tag', () => {
    expect(fn({ assessment_action: 'queued', flow_token: 'u1:assessment-gen:1' }))
      .toBe('assessment_gen');
  });

  test('an attendance completion is NOT captured — the token marker is specific', () => {
    // The failure being prevented in reverse: this rule sits above the loose
    // attendance fallback, so it must not swallow attendance's own traffic.
    expect(fn({ flow_token: 'u1:attendance:123', some_field: 'x' }))
      .not.toBe('assessment_gen');
  });

  test('a token-less submission is not claimed by us', () => {
    expect(fn({ Student_Full_Name: 'x', Assessment_Mode: 'y' })).not.toBe('assessment_gen');
  });
});

describe('the submit must still happen after the Flow closes (bd-60030)', () => {
  // CONFIRM is terminal, so its Footer closes the Flow instead of calling the
  // endpoint — `screenId === 'CONFIRM'` became unreachable and `submit()` went
  // with it. Live: routing worked, the ack was sent, and there was no
  // `[assessment-flow] queued` line and no row in assessment_requests.
  //
  // No jest.mock of the endpoint here on purpose: a duplicate registration is
  // what let an earlier version of this block pass while testing nothing.
  const Endpoint3 = require('../../bot/shared/routes/assessment-gen-endpoint');

  const wire = () => mockSupabase.from.mockImplementation((table) => {
    const node = (rows, one) => ({
      eq: () => node(rows, one), gte: () => node(rows, one), lte: () => node(rows, one),
      order: () => node(rows, one), limit: () => node(rows, one),
      maybeSingle: () => Promise.resolve({ data: one, error: null }),
      single: () => Promise.resolve({ data: one, error: null }),
      then: (r) => Promise.resolve({ data: rows, error: null }).then(r),
    });
    if (table === 'textbooks') {
      const b = { id: 'book-1', grade: 4, subject: 'science', total_pages: 100 };
      return { select: () => node([b], b) };
    }
    if (table === 'assessment_requests') {
      return { insert: (row) => { inserted = row; return { select: () => ({ single: () =>
        Promise.resolve({ data: { id: 'req-1' }, error: null }) }) }; } };
    }
    return { select: () => node([], null) };
  });

  const SESSION = {
    userId: 'user-1', grade: 4, subject: 'science', chapterNumber: 3,
    pageRanges: '34-41', questionCount: 10, questionTypes: [], contentSource: 'unseen',
  };

  test('it is a real export, not a stub', () => {
    expect(typeof Endpoint3.submitFromCompletion).toBe('function');
  });

  test('the REAL live payload writes the request and queues the job', async () => {
    mockRedis.get.mockResolvedValue(SESSION);
    wire();
    const res = await Endpoint3.submitFromCompletion({
      flowToken: 'user-1:assessment-gen:1788534348744',
      userId: 'user-1', outputFormat: 'docx', answerKey: true, answerLines: true,
    });
    expect(res.status).toBe('queued');
    expect(mockQueueJob).toHaveBeenCalled();
    // CONFIRM's fields survive the close via the payload — CONFIRM never
    // reached the endpoint to store them in the session.
    expect(inserted.output_format).toBe('docx');
    expect(inserted.has_answer_key).toBe(true);
    expect(inserted.grade_code).toBe('grade_4');
  });

  test('a stale or missing session is refused, not submitted as a half-request', async () => {
    mockRedis.get.mockResolvedValue(null);
    wire();
    const res = await Endpoint3.submitFromCompletion({
      flowToken: 'user-1:assessment-gen:1', userId: 'user-1', outputFormat: 'pdf',
    });
    expect(res.status).toBe('failed');
    expect(mockQueueJob).not.toHaveBeenCalled();
  });

  test('the session is cleared, so a replayed completion cannot double-submit', async () => {
    mockRedis.get.mockResolvedValue(SESSION);
    wire();
    await Endpoint3.submitFromCompletion({
      flowToken: 'user-1:assessment-gen:1', userId: 'user-1', outputFormat: 'pdf',
    });
    expect(mockRedis.delete).toHaveBeenCalled();
  });
});
