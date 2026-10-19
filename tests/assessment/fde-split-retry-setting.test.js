/**
 * The level-split retry's setting, `assessment_fde_split_retry` (bd-5jmnfj.18): read by the
 * orchestrator per pattern paper. On, the engine is told `splitRetry: true` and writes a paper off
 * FDE's split once more; absent, false or a failed read leaves the call exactly as it was.
 *
 * The fake database is fde-reader-gate's.
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

const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const Orchestrator = require('../../bot/shared/services/assessment/assessment-orchestrator.service');

const P = Patterns.get('fde_g5_2027');
const KEY = 'assessment_fde_split_retry';
const exam = () => applyLayout(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'maths.json'), 'utf8')), P.subjects.maths, { kind: 'fde' }).examJson;
const JOB = {
  userId: 'teacher-1', requestId: 'req-maths', grade: 5, subject: 'maths', pageRanges: null, questionTypes: [],
  contentSource: 'unseen', questionCount: 48, outputFormat: 'pdf', deliver: 'none',
  pattern: 'fde_g5_2027', scope: { kind: 'fde', chapters: null, pages: null },
};
const setting = (value) => { mockState.rows.app_settings = value === undefined ? [] : [{ key: KEY, value }]; };

beforeEach(() => {
  mockState.rows = { users: [{ id: 'teacher-1', phone_number: 'wa-teacher-1', preferred_language: 'en', school_name: null }] };
  mockState.seq = 0;
  mockState.calls = [];
  jest.clearAllMocks();
  mockGeneratePatternExam.mockResolvedValue({ examJson: exam(), questionCount: 48, tokenData: {}, pageReference: '1-40', layout: { placed: 48, unplaced: 0 } });
  mockHtmlToPdf.mockResolvedValue(Buffer.from('%PDF-1.4\n%%EOF'));
  mockUpload.mockResolvedValue({ key: 'k' });
});

const args = async () => {
  await Orchestrator.buildPaper(JOB, {}).catch(() => null);
  expect(mockGeneratePatternExam).toHaveBeenCalledTimes(1);
  return mockGeneratePatternExam.mock.calls[0][0];
};

test('setting on: the engine is told to write a paper off its split once more', async () => {
  setting(true);
  expect(await args()).toMatchObject({ subject: 'maths', splitRetry: true });
});

test.each([
  ['absent', undefined],
  ['false', false],
  ['a list', ['maths']],
])('setting %s: no splitRetry key at all', async (name, value) => {
  setting(value);
  expect('splitRetry' in (await args())).toBe(false);
});
