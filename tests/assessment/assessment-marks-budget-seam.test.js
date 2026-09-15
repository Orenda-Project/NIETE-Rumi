/**
 * The marks budget has to SURVIVE THE WHOLE CHAIN, not just exist at both ends.
 *
 * She types it on a Flow screen; it is enforced four hops later inside the
 * generation service. In between it passes through the request service, an SQS
 * job payload, and the orchestrator — and a parameter dropped at any one of
 * those hops is invisible to a test that calls either end directly. Every unit
 * test around it still passes; the budget is simply never applied, and the only
 * symptom is a paper that quietly ignores what she asked for.
 *
 * That exact failure has shipped here before (a parameter dropped one hop short
 * of its use site, green under 28 tests), which is why this seam is pinned
 * hop-by-hop rather than trusted.
 */

const mockSupabase = { from: jest.fn() };
const mockQueueJob = jest.fn().mockResolvedValue({ MessageId: 'm1' });

jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: mockQueueJob }));

let inserted;

function wireDb() {
  inserted = null;
  mockSupabase.from.mockImplementation(() => ({
    insert: (row) => {
      inserted = row;
      return { select: () => ({ single: () => Promise.resolve({ data: { id: 'req-1' }, error: null }) }) };
    },
  }));
}

const AssessmentRequest = require('../../bot/shared/services/assessment/assessment-request.service');

const SPEC = {
  userId: 'u1',
  grade: 4,
  subject: 'science',
  textbookId: 'tb-1',
  chapterNumber: 3,
  contentSource: 'unseen',
  questionCount: 10,
};

beforeEach(() => {
  jest.clearAllMocks();
  wireDb();
});

describe('the budget reaches the worker', () => {
  test('a budget she set rides the job payload to the worker', async () => {
    await AssessmentRequest.createAndQueue({ ...SPEC, totalMarks: 40 });
    expect(mockQueueJob.mock.calls[0][2].totalMarks).toBe(40);
  });

  test('no budget puts an explicit null on the payload, not a missing key', async () => {
    // `undefined` disappears through JSON, and a worker reading `undefined`
    // cannot tell "she set none" from "an older producer never sent it".
    await AssessmentRequest.createAndQueue({ ...SPEC });
    const payload = mockQueueJob.mock.calls[0][2];
    expect(payload).toHaveProperty('totalMarks');
    expect(payload.totalMarks).toBeNull();
  });

  test('the budget is NOT written to the request row — no column holds it', async () => {
    // total_marks on the paper row is the ACHIEVED total. Writing the requested
    // one there would overload a column that already means something else.
    await AssessmentRequest.createAndQueue({ ...SPEC, totalMarks: 40 });
    expect(inserted).not.toHaveProperty('total_marks');
  });
});

describe('the orchestrator hands it to the generator', () => {
  test('the job payload parameter arrives at generateExam under the same name', () => {
    // Pinned by source shape rather than by running the orchestrator, which
    // needs R2, a renderer and a live paper row. The two hops either side of it
    // are executed for real above and in the generation suite; this asserts the
    // middle one does not silently rename or drop the field.
    const fs = require('fs');
    const src = fs.readFileSync(
      require.resolve('../../bot/shared/services/assessment/assessment-orchestrator.service'), 'utf8');
    expect(src).toMatch(/questionCount,\s*totalMarks/);
    expect(src).toMatch(/contentSource,\s*questionCount,\s*totalMarks,\s*questionTypes/);
  });
});
