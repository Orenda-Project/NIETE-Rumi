/**
 * The reader pass's setting, `assessment_fde_reader_pass_subjects`: read by the orchestrator per
 * pattern paper, fail closed (absent, [], malformed or a failed read is off), and read only for a
 * subject the pass was built for. The engine is told `readerPass: true` only then; every other
 * call to it is the call it was before.
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
const Flags = require('../../bot/shared/config/feature-flags');
const Orchestrator = require('../../bot/shared/services/assessment/assessment-orchestrator.service');

const P = Patterns.get('fde_g5_2027');
const KEY = 'assessment_fde_reader_pass_subjects';
const exam = () => applyLayout(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'maths.json'), 'utf8')), P.subjects.maths, { kind: 'fde' }).examJson;
const JOB = (subject) => ({
  userId: 'teacher-1', requestId: `req-${subject}`, grade: 5, subject, pageRanges: null, questionTypes: [],
  contentSource: 'unseen', questionCount: 48, outputFormat: 'pdf', deliver: 'none',
  pattern: 'fde_g5_2027', scope: { kind: 'fde', chapters: null, pages: null },
});
const settingReads = () => mockState.calls.filter((c) => c.table === 'app_settings' && c.filters.some(([k, , v]) => k === 'key' && v === KEY));
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

const argsOf = async (subject) => {
  await Orchestrator.buildPaper(JOB(subject), {}).catch(() => null);
  expect(mockGeneratePatternExam).toHaveBeenCalledTimes(1);
  return mockGeneratePatternExam.mock.calls[0][0];
};

describe('the orchestrator tells the engine to read only when the setting names the subject', () => {
  test('urdu, setting ["urdu"]: readerPass is passed', async () => {
    setting(['urdu']);
    expect(await argsOf('urdu')).toMatchObject({ subject: 'urdu', readerPass: true });
    expect(settingReads()).toHaveLength(1);
  });

  test('the setting as a JSON string, any case, is read the same', async () => {
    setting('[" Urdu "]');
    expect((await argsOf('urdu')).readerPass).toBe(true);
  });

  test.each([
    ['absent', undefined],
    ['an empty list', []],
    ['a bare string', 'urdu'],
    ['true', true],
    ['a list of non-strings', [1, 2]],
    ['other subjects only', ['maths', 'english']],
  ])('urdu, setting %s: no readerPass key at all', async (name, value) => {
    setting(value);
    const args = await argsOf('urdu');
    expect('readerPass' in args).toBe(false);
  });

  test('social_studies, setting ["social_studies"]: readerPass is passed', async () => {
    setting(['social_studies']);
    expect(await argsOf('social_studies')).toMatchObject({ subject: 'social_studies', readerPass: true });
    expect(settingReads()).toHaveLength(1);
  });

  test('social_studies, setting ["urdu"]: no readerPass key at all', async () => {
    setting(['urdu']);
    expect('readerPass' in (await argsOf('social_studies'))).toBe(false);
  });

  test.each(['maths', 'science', 'english'])('%s, setting naming it: never read, no readerPass key', async (subject) => {
    setting([subject, 'urdu']);
    const args = await argsOf(subject);
    expect('readerPass' in args).toBe(false);
    expect(settingReads()).toHaveLength(0);
  });
});

describe('fdeReaderPassSubjects fails closed', () => {
  test('a failed read is off, and logged', async () => {
    const from = jest.spyOn(require('../../bot/shared/config/supabase'), 'from').mockImplementation(() => { throw new Error('db down'); });
    await expect(Flags.fdeReaderPassSubjects()).resolves.toEqual([]);
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('treating as off'), expect.objectContaining({ key: KEY }));
    from.mockRestore();
  });

  test('a read error row is off', async () => {
    const from = jest.spyOn(require('../../bot/shared/config/supabase'), 'from').mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }),
    }));
    await expect(Flags.fdeReaderPassSubjects()).resolves.toEqual([]);
    from.mockRestore();
  });
});
