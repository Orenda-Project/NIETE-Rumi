/**
 * S2 + S3 — one definition of "an assessment was requested".
 *
 * Before this there was exactly one way to ask for a paper, and it lived
 * halfway down the WhatsApp Flow endpoint: `submit()` wrote the
 * assessment_requests row and queued the job, with `surface: 'whatsapp'`
 * hardcoded and the function exported only under `_internal` for tests.
 *
 * A second surface cannot reuse that, and must not copy it. Copying is how the
 * two surfaces drift: the row and the job payload have to agree on eleven
 * fields, and a copy agrees on the day it is written and never again.
 *
 * So the envelope moves to its own service that takes `surface`, and the Flow
 * endpoint calls it. Two properties are pinned here:
 *
 *   1. `createAndQueue` writes the row and queues the job, IN THAT ORDER. The
 *      row is what the worker is handed and what the watchdog looks for, so a
 *      queued job referring to nothing is worse than a row with no job.
 *   2. `deliver` decides whether the worker sends anything. 'whatsapp' is the
 *      default and is what the Flow has always produced, so an existing job in
 *      the queue — written before this change and carrying no `deliver` at all
 *      — still gets delivered.
 */

const mockSupabase = { from: jest.fn() };
const mockQueueJob = jest.fn().mockResolvedValue({ MessageId: 'm1' });

jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: mockQueueJob }));

let inserted;
let order;

function wireDb({ failInsert = false } = {}) {
  inserted = null;
  order = [];
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'assessment_requests') {
      return {
        insert: (row) => {
          inserted = row;
          order.push('insert');
          return { select: () => ({ single: () => Promise.resolve(
            failInsert
              ? { data: null, error: { code: '23502', message: 'boom' } }
              : { data: { id: 'req-1' }, error: null }) }) };
        },
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  mockQueueJob.mockImplementation(() => { order.push('queue'); return Promise.resolve({ MessageId: 'm1' }); });
}

const SPEC = {
  userId: 'u1',
  grade: 4,
  subject: 'science',
  textbookId: 'book-uuid',
  chapterNumber: 3,
  pageRanges: '34-41',
  contentSource: 'unseen',
  questionCount: 20,
  questionTypes: [{ id: 'MCQs', count: 20, category: 'objective' }],
  includeAnswerKey: false,
  answerLines: true,
  outputFormat: 'pdf',
};

const Enqueue = () => require('../../bot/shared/services/assessment/assessment-request.service');

beforeEach(() => { jest.clearAllMocks(); wireDb(); });

describe('createAndQueue — the one place a request becomes a job', () => {
  it('is exported', () => {
    expect(typeof Enqueue().createAndQueue).toBe('function');
  });

  it('writes the row BEFORE queueing, so a job never refers to nothing', async () => {
    await Enqueue().createAndQueue({ ...SPEC, surface: 'whatsapp' });
    expect(order).toEqual(['insert', 'queue']);
  });

  it('records the surface it was asked from', async () => {
    await Enqueue().createAndQueue({ ...SPEC, surface: 'portal' });
    expect(inserted.surface).toBe('portal');
  });

  it('defaults to whatsapp, because that is what every caller meant before this existed', async () => {
    await Enqueue().createAndQueue({ ...SPEC });
    expect(inserted.surface).toBe('whatsapp');
  });

  it('shapes the row the way the schema wants it', async () => {
    await Enqueue().createAndQueue({ ...SPEC, surface: 'portal' });
    // grade_code, not grade — the column is a FK to grade_levels(code).
    expect(inserted).toMatchObject({
      user_id: 'u1',
      grade_code: 'grade_4',
      subject_code: 'science',
      textbook_id: 'book-uuid',
      chapter_number: 3,
      page_ranges: '34-41',
      question_count: 20,
      has_answer_key: false,
      has_answer_lines: true,
      output_format: 'pdf',
    });
  });

  it('hands back the request id, because the caller has to poll on something', async () => {
    const out = await Enqueue().createAndQueue({ ...SPEC, surface: 'portal' });
    expect(out.requestId).toBe('req-1');
  });

  it('does not queue a job when the row could not be written', async () => {
    wireDb({ failInsert: true });
    await expect(Enqueue().createAndQueue({ ...SPEC })).rejects.toThrow();
    expect(mockQueueJob).not.toHaveBeenCalled();
  });
});

describe('deliver — whether the worker sends anything', () => {
  it('a whatsapp request queues a job that delivers', async () => {
    await Enqueue().createAndQueue({ ...SPEC, surface: 'whatsapp' });
    const [, type, payload] = mockQueueJob.mock.calls[0];
    expect(type).toBe('assessment_generate');
    expect(payload.deliver).toBe('whatsapp');
  });

  it('a portal request queues a job that delivers NOTHING', async () => {
    await Enqueue().createAndQueue({ ...SPEC, surface: 'portal' });
    const [, , payload] = mockQueueJob.mock.calls[0];
    expect(payload.deliver).toBe('none');
    // Same job type — the worker case is untouched, so there is no second
    // queue, no second consumer and no second thing to keep in step.
    expect(mockQueueJob.mock.calls[0][1]).toBe('assessment_generate');
  });

  it('carries the requestId the worker needs to find its row', async () => {
    await Enqueue().createAndQueue({ ...SPEC, surface: 'portal' });
    const [, , payload] = mockQueueJob.mock.calls[0];
    expect(payload.requestId).toBe('req-1');
    expect(payload.userId).toBe('u1');
  });

  it('passes the generation spec through untouched', async () => {
    await Enqueue().createAndQueue({ ...SPEC, surface: 'portal' });
    const [, , payload] = mockQueueJob.mock.calls[0];
    expect(payload).toMatchObject({
      grade: 4, subject: 'science', chapterNumber: 3, pageRanges: '34-41',
      contentSource: 'unseen', questionCount: 20, includeAnswerKey: false,
      answerLines: true, outputFormat: 'pdf',
    });
  });
});
