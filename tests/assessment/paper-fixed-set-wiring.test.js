/**
 * The fixed set of whole-book papers, wired into the orchestrator. With `assessment_paper_fixed_set`
 * on, a full-book request on a pattern with a set is served a set paper and the writer is not
 * called; with nothing in the set it falls back to today's donor-or-write path. A chosen-chapters
 * request never uses the set. The set query itself is tested in paper-fixed-set.test.js.
 *
 * The fake database is paper-reuse-wiring's.
 */

const fs = require('fs');
const path = require('path');

const mockState = { rows: {}, seq: 0, calls: [] };

function mockFakeDb() {
  const now = () => new Date().toISOString();
  function from(table) {
    const st = { table, op: 'select', payload: null, filters: [], order: null, limit: null };
    const rows = () => (mockState.rows[table] ||= []);
    const match = (r) => st.filters.every(([k, op, v]) => (op === 'is' ? (v === null ? r[k] == null : r[k] === v) : r[k] === v));
    const run = () => {
      mockState.calls.push({ table, op: st.op, payload: st.payload, filters: st.filters.slice() });
      if (st.op === 'insert') {
        const p = st.payload;
        if (table === 'assessment_papers') {
          const clash = rows().find((r) => r.request_id === p.request_id && r.edited_from == null);
          if (clash) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        mockState.seq += 1;
        const row = { id: `paper-${mockState.seq}`, attempt: 1, edited_from: null, created_at: now(), updated_at: now(), ...p };
        rows().push(row);
        return { data: row, error: null };
      }
      if (st.op === 'update') {
        rows().filter(match).forEach((r) => Object.assign(r, JSON.parse(JSON.stringify(st.payload))));
        return { data: null, error: null };
      }
      let hit = rows().filter(match);
      if (st.limit != null) hit = hit.slice(0, st.limit);
      return { data: hit, error: null };
    };
    const b = {
      insert: (p) => { st.op = 'insert'; st.payload = p; return b; },
      update: (p) => { st.op = 'update'; st.payload = p; return b; },
      select: () => b,
      eq: (k, v) => { st.filters.push([k, 'eq', v]); return b; },
      is: (k, v) => { st.filters.push([k, 'is', v]); return b; },
      in: () => b,
      order: () => b,
      limit: (n) => { st.limit = n; return b; },
      single: async () => { const r = run(); if (r.error) return r; const d = Array.isArray(r.data) ? r.data[0] : r.data; return { data: d || null, error: d ? null : { message: 'no rows' } }; },
      maybeSingle: async () => { const r = run(); if (r.error) return r; const d = Array.isArray(r.data) ? r.data[0] : r.data; return { data: d || null, error: null }; },
      then: (ok, ko) => Promise.resolve(run()).then(ok, ko),
    };
    return b;
  }
  return { from };
}

jest.mock('../../bot/shared/config/supabase', () => mockFakeDb());

const mockLoadContent = jest.fn();
const mockGenerateExam = jest.fn();
const mockGeneratePatternExam = jest.fn();
const mockHtmlToPdf = jest.fn();
const mockUpload = jest.fn();
const mockSendDocumentByLink = jest.fn();
const mockSendMessage = jest.fn();
const mockLog = jest.fn();

jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadChapterContent: (...a) => mockLoadContent(...a),
  loadPageRangeContent: (...a) => mockLoadContent(...a),
}));
jest.mock('../../bot/shared/services/assessment/assessment-generation.service', () => ({
  generateExam: (...a) => mockGenerateExam(...a),
  generatePatternExam: (...a) => mockGeneratePatternExam(...a),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: (...a) => mockHtmlToPdf(...a) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadExamBuffer: (...a) => mockUpload(...a),
  buildR2PublicUrl: (k) => `https://r2/${k}`,
  getPresignedUrl: async (u) => `${u}?signed`,
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendDocumentByLink: (...a) => mockSendDocumentByLink(...a),
  sendMessage: (...a) => mockSendMessage(...a),
  sendFlow: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a), logError: jest.fn() }));

const mockFindDonor = jest.fn();
jest.mock('../../bot/shared/services/assessment/paper-reuse', () => ({
  ...jest.requireActual('../../bot/shared/services/assessment/paper-reuse'),
  findDonor: (...a) => mockFindDonor(...a),
}));

const mockFindSetPaper = jest.fn();
jest.mock('../../bot/shared/services/assessment/paper-fixed-set', () => ({
  ...jest.requireActual('../../bot/shared/services/assessment/paper-fixed-set'),
  findSetPaper: (...a) => mockFindSetPaper(...a),
}));

const mockPrevious = jest.fn();
jest.mock('../../bot/shared/services/assessment/repeat-guard', () => ({
  ...jest.requireActual('../../bot/shared/services/assessment/repeat-guard'),
  previousQuestions: (...a) => mockPrevious(...a),
}));

const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const Reuse = require('../../bot/shared/services/assessment/paper-reuse');
const Orchestrator = require('../../bot/shared/services/assessment/assessment-orchestrator.service');

const P = Patterns.get('fde_g5_2027');
const exam = () => applyLayout(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'maths.json'), 'utf8')), P.subjects.maths, { kind: 'fde' }).examJson;
const JOB = {
  userId: 'teacher-1', requestId: 'req-maths', grade: 5, subject: 'maths', pageRanges: null, questionTypes: [],
  contentSource: 'unseen', questionCount: 48, outputFormat: 'pdf', deliver: 'none',
  pattern: 'fde_g5_2027', scope: { kind: 'fde', chapters: null, pages: null },
};
const KEY = Reuse.reuseKey({
  grade: 5, subject: 'maths', pattern: 'fde_g5_2027', scope: JOB.scope, pageRanges: null, chapterNumber: undefined,
  readerPass: false, splitRetry: false, stemCheck: false,
});
/** app_settings rows: each named setting on. */
const settings = (...on) => { mockState.rows.app_settings = on.map((key) => ({ key, value: true })); };
const firstPatch = () => mockState.calls.find((c) => c.op === 'update' && c.table === 'assessment_papers' && c.payload?.exam_json).payload;

beforeEach(() => {
  mockState.rows = { users: [{ id: 'teacher-1', phone_number: 'wa-teacher-1', preferred_language: 'en', school_name: null }] };
  mockState.seq = 0;
  mockState.calls = [];
  jest.clearAllMocks();
  mockGeneratePatternExam.mockResolvedValue({ examJson: exam(), questionCount: 48, tokenData: { model: 'm', inputTokens: 9, outputTokens: 9 }, pageReference: '1-40', layout: { placed: 48, unplaced: 0 } });
  mockFindDonor.mockResolvedValue(null);
  mockFindSetPaper.mockResolvedValue(null);
  mockPrevious.mockResolvedValue([]);
  mockHtmlToPdf.mockResolvedValue(Buffer.from('%PDF-1.4\n%%EOF'));
  mockUpload.mockResolvedValue({ key: 'k' });
});

const build = () => Orchestrator.buildPaper(JOB, {}).catch(() => null);
const readyPatch = () => mockState.calls.find((c) => c.op === 'update' && c.table === 'assessment_papers' && c.payload?.status === 'ready').payload;

const SET_PAPER = () => ({ id: 'set-3', examJson: exam(), questionCount: 48, model: 'sonnet', pageReference: '1-138' });

test('setting off: no set read, written as before', async () => {
  settings();
  await build();
  expect(mockFindSetPaper).not.toHaveBeenCalled();
  expect(mockGeneratePatternExam).toHaveBeenCalledTimes(1);
  expect(firstPatch().exam_json._reuse).toEqual({ key: KEY, page_reference: '1-40' });
});

test('setting on, a set paper: the writer is not called and her copy points at the set paper', async () => {
  settings('assessment_paper_fixed_set');
  mockFindSetPaper.mockResolvedValue(SET_PAPER());
  await build();
  expect(mockFindSetPaper).toHaveBeenCalledWith(expect.objectContaining({ set: 'fde_g5_2027-v1/maths', subject: 'maths', userId: 'teacher-1' }));
  expect(mockGeneratePatternExam).not.toHaveBeenCalled();
  expect(mockFindDonor).not.toHaveBeenCalled();
  const p = firstPatch();
  expect(p.exam_json._reuse).toEqual({ key: KEY, from: 'set-3', page_reference: '1-138' });
  expect(p).toMatchObject({ question_count: 48, model: 'sonnet', input_tokens: 0, output_tokens: 0 });
  expect(mockHtmlToPdf).toHaveBeenCalled();
});

test('setting on, the set is empty: falls back to the donor path', async () => {
  settings('assessment_paper_fixed_set', 'assessment_paper_reuse');
  mockFindDonor.mockResolvedValue({ id: 'paper-old', examJson: exam(), questionCount: 48, model: 'sonnet', pageReference: '1-40' });
  await build();
  expect(mockFindSetPaper).toHaveBeenCalledTimes(1);
  expect(mockGeneratePatternExam).not.toHaveBeenCalled();
  expect(firstPatch().exam_json._reuse).toEqual({ key: KEY, from: 'paper-old', page_reference: '1-40' });
});

test('setting on, the set is empty and no donor: written fresh', async () => {
  settings('assessment_paper_fixed_set');
  await build();
  expect(mockFindSetPaper).toHaveBeenCalledTimes(1);
  expect(mockGeneratePatternExam).toHaveBeenCalledTimes(1);
  expect(firstPatch().exam_json._reuse).toEqual({ key: KEY, page_reference: '1-40' });
});

test('setting on, chosen chapters: the set is never used', async () => {
  settings('assessment_paper_fixed_set');
  mockFindSetPaper.mockResolvedValue(SET_PAPER());
  await Orchestrator.buildPaper({ ...JOB, scope: { kind: 'chapters', chapters: [1, 2], pages: null } }, {}).catch(() => null);
  expect(mockFindSetPaper).not.toHaveBeenCalled();
  expect(mockGeneratePatternExam).toHaveBeenCalledTimes(1);
});
