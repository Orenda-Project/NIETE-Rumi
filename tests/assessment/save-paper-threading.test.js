/**
 * bd-ipoxhx.5 — ICT Feedback AG row 30: "Save paper" is her choice, off unless she ticks it.
 *
 * It rides the request's JOB PAYLOAD only (no column, like totalMarks) and is stamped on the paper
 * as `exam_json._print`, beside `_topics` and `_oral`, so every edit and re-render keeps it without
 * a migration or a new select. An unticked paper's row and job are exactly what they were.
 */


const mockRedis = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
const mockSupabase = { from: jest.fn() };
const mockQueueJob = jest.fn().mockResolvedValue({ MessageId: 'm1' });
const mockListChapters = jest.fn();

jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: mockQueueJob }));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  listChapters: (...a) => mockListChapters(...a),
  parsePageRanges: jest.requireActual(
    '../../bot/shared/services/assessment/book-content.service').parsePageRanges,
}));
jest.mock('../../bot/shared/services/assessment/assessment-format', () => ({
  ...jest.requireActual('../../bot/shared/services/assessment/assessment-format'),
  resolveFormat: jest.fn(async () => 'pdf'),
}));

const FLOW = require('../../docs/flows/assessment-gen-flow.json');
const Endpoint = require('../../bot/shared/routes/assessment-gen-endpoint');
const Request = require('../../bot/shared/services/assessment/assessment-request.service');

const BOOK = { id: 'book-uuid', total_pages: 166 };
const CHAPTERS = [{ chapterNumber: 1, title: 'Hello World!', pageStart: 4, pageEnd: 14 }];
let inserted;

function wireDb() {
  inserted = null;
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'textbooks') {
      return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({
        maybeSingle: () => Promise.resolve({ data: BOOK, error: null }),
      }) }) }) }) };
    }
    if (table === 'assessment_requests') {
      return {
        insert: (row) => {
          inserted = row;
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'req-1' }, error: null }) }) };
        },
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
}

const SESSION = {
  userId: 'u1', grade: 1, subject: 'english',
  chapterNumber: 1, chapterTitle: 'Hello World!', pageRanges: null,
  questionCount: 10, contentSource: 'unseen',
};

beforeEach(() => {
  jest.clearAllMocks();
  wireDb();
  mockListChapters.mockResolvedValue(CHAPTERS);
  mockRedis.get.mockResolvedValue({ ...SESSION });
  mockRedis.set.mockResolvedValue(true);
});

  mockRedis.delete.mockResolvedValue(true);
const Selection = require('../../bot/shared/services/assessment/assessment-selection');
const Renderer = require('../../bot/shared/services/assessment/assessment-paper.renderer');
const { compactCss } = require('../../bot/shared/services/assessment/compact-print');

const confirm = () => FLOW.screens.find((s) => s.id === 'CONFIRM');
const walk = (node, visit) => {
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
  else if (node && typeof node === 'object') { visit(node); Object.values(node).forEach((v) => walk(v, visit)); }
};
const job = () => mockQueueJob.mock.calls[0][2];

describe('the Flow asks once, unticked', () => {
  it('CONFIRM has a "Save paper" OptIn, unticked, and the footer sends it', () => {
    let form = null; let optIn = null; let payload = null;
    walk(confirm(), (n) => {
      if (n.type === 'Form') form = n;
      if (n.type === 'OptIn' && n.name === 'save_paper') optIn = n;
      if (n.type === 'Footer') payload = n['on-click-action'].payload;
    });
    expect(optIn).toBeTruthy();
    expect(optIn.required).not.toBe(true);
    expect(form['init-values']).toMatchObject({ save_paper: false });
    expect(payload).toHaveProperty('save_paper', '${form.save_paper}');
  });
});

describe('the choice reaches the job, and only when ticked', () => {
  it.each([
    ['true', true], ['"true"', 'true'],
  ])('save_paper %s → job.compact true', async (_l, value) => {
    await Endpoint.submitFromCompletion({ flowToken: 'u1:assessment', userId: 'u1', outputFormat: 'pdf', savePaper: value });
    expect(job().compact).toBe(true);
  });

  it.each([
    ['missing', undefined], ['false', false], ['"false"', 'false'],
  ])('save_paper %s → no compact key on the job, no new column on the row', async (_l, value) => {
    await Endpoint.submitFromCompletion({ flowToken: 'u1:assessment', userId: 'u1', outputFormat: 'pdf', savePaper: value });
    expect(job()).not.toHaveProperty('compact');
    expect(Object.keys(inserted).some((k) => /compact|save_paper/.test(k))).toBe(false);
  });

  it('the data-exchange CONFIRM path honours the same rule', async () => {
    await Endpoint.handleAssessmentGenDataExchange('u1', 'CONFIRM', { output_format: 'pdf', save_paper: true }, 'u1:assessment');
    expect(job().compact).toBe(true);
  });

  it('the portal path (createAndQueue) carries it too', async () => {
    await Request.createAndQueue({
      userId: 'u1', surface: 'portal', grade: 1, subject: 'english', textbookId: 'b',
      chapterNumber: 1, pageRanges: '4-14', questionCount: 5,
      questionTypes: [{ id: 'MCQs', count: 5, category: 'objective' }], compact: true,
    });
    expect(job().compact).toBe(true);
  });
});

describe('the paper keeps it through edits', () => {
  const EXAM = { _print: { compact: true }, unseen: { objective: { MCQs: [{ question: 'a', options: ['1', '2'], marks: 1 }, { question: 'b', options: ['1', '2'], marks: 1 }] } } };

  it('a paper stamped _print.compact prints tight with no flag passed', () => {
    expect(Renderer.renderPaper({ examJson: EXAM, grade: 4, subject: 'science' })).toContain(compactCss({ rtl: false }));
  });

  it('keeping some questions keeps the stamp', () => {
    const kept = Selection.applySelection(EXAM, ['unseen.objective.MCQs.0']);
    expect(kept._print).toEqual({ compact: true });
    expect(Renderer.renderPaper({ examJson: kept, grade: 4, subject: 'science' })).toContain(compactCss({ rtl: false }));
  });
});
