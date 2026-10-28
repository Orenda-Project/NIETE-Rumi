/**
 * A board-pattern job through buildPaper: generate by pattern, print both documents with their own
 * footers, count the pages the PDFs actually have, and write it all to the paper row before the
 * build returns.
 *
 * The page total is never typed (the marking scheme's box tells the teacher how many pages the
 * paper has, and the app's Ready row shows both counts), so the counts come from the PDF bytes:
 * one `/Type /Page` object per page, and never the `/Type /Pages` tree node above them. The footer
 * carries Chromium's own page number and total, and its fonts only load when the options travel
 * with the HTML they were made for, so each document is rendered with ITS options.
 *
 * Real renderers, real format module; mocked at the edges only: the database, storage, the PDF
 * engine and the model (generatePatternExam is mocked to its contract; fde-chain runs the real one).
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

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const { mathsCheck } = require('../../bot/shared/services/assessment/maths-check');
const Fde = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const Orchestrator = require('../../bot/shared/services/assessment/assessment-orchestrator.service');

const NOW = '2026-10-20T07:12:00.000Z';
const P = Patterns.get('fde_g5_2027');

function patternExam(name = 'maths') {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
  const laid = applyLayout(raw, P.subjects[name], { kind: 'fde' }, { now: NOW }).examJson;
  return mathsCheck(normaliseScheme(laid).examJson, { subject: name }).examJson;
}

/** A PDF-shaped buffer with `n` page objects and the page-tree node that must not be counted. */
function fakePdf(n, tag) {
  const pages = Array.from({ length: n }, (_, i) => `${i + 3} 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n`).join('');
  return Buffer.from(`%PDF-1.4\n%${tag}\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count ${n} >>\nendobj\n${pages}%%EOF`, 'latin1');
}

const PATTERN_JOB = {
  userId: 'teacher-1', requestId: 'req-p', grade: 5, subject: 'maths',
  pageRanges: '1-40', questionTypes: [{ id: 'MCQs', count: 20, category: 'objective', slot: 'maths.A.Q1a' }],
  contentSource: 'unseen', questionCount: 48, totalMarks: 130, outputFormat: 'pdf', deliver: 'none',
  pattern: 'fde_g5_2027', scope: { kind: 'fde', chapters: null, pages: null },
};
const TODAY_JOB = {
  userId: 'teacher-1', requestId: 'req-t', grade: 5, subject: 'maths', chapterNumber: 2,
  questionTypes: [{ id: 'MCQs', count: 2, category: 'objective' }], contentSource: 'unseen', outputFormat: 'pdf',
};

const papers = () => mockState.rows.assessment_papers || [];
let exam;

beforeEach(() => {
  mockState.rows = { users: [{ id: 'teacher-1', phone_number: 'wa-teacher-1', preferred_language: 'en', school_name: null }] };
  mockState.seq = 0;
  mockState.calls = [];
  jest.clearAllMocks();
  exam = patternExam('maths');
  // clearAllMocks keeps a queue of *Once replies; a reply one test left unused must not reach the next.
  mockGeneratePatternExam.mockReset();
  mockGeneratePatternExam.mockResolvedValue({
    examJson: exam, questionCount: 48,
    tokenData: { inputTokens: 100, outputTokens: 50, totalTokens: 150, model: 'm' },
    pageReference: '1-40', chapterTitle: null, sections: ['A', 'B', 'C'], elapsedMs: 10, layout: exam._layout,
  });
  mockLoadContent.mockResolvedValue({ content: '=== Page 12 ===\nFractions', pageReference: '12-20', chapterTitle: 'Fractions' });
  mockGenerateExam.mockResolvedValue({
    examJson: { unseen: { objective: { MCQs: [{ question: 'q1', marks: 1 }, { question: 'q2', marks: 1 }] } } },
    questionCount: 2, tokenData: { inputTokens: 10, outputTokens: 5, model: 'm' },
  });
  // The paper is rendered first and has 4 pages; the scheme second, with 6.
  mockHtmlToPdf.mockImplementation(async (html) => (/MARKING SCHEME|class="record"/.test(html) ? fakePdf(6, 'scheme') : fakePdf(4, 'paper')));
  mockUpload.mockImplementation(async ({ filename }) => `exams/teacher-1/${filename}`);
  mockSendDocumentByLink.mockResolvedValue(true);
  mockSendMessage.mockResolvedValue(true);
});

describe('a board-pattern job', () => {
  test('pdfOptions passed to htmlToPdf', async () => {
    const out = await Orchestrator.buildPaper(PATTERN_JOB, {});
    expect(out.status).toBe('ready');
    expect(mockHtmlToPdf).toHaveBeenCalledTimes(2);
    const [[paperHtml, paperOpts], [schemeHtml, schemeOpts]] = mockHtmlToPdf.mock.calls;
    expect(paperHtml).toContain('data-section=');
    expect(schemeHtml).toContain('class="record"');
    // Each document with its own footer, beside today's timeout; htmlToPdf spreads
    // `pdfOptions` into page.pdf().
    expect(paperOpts).toEqual({ timeout: 60000, pdfOptions: Fde.pdfOptions(exam, 'paper') });
    expect(schemeOpts).toEqual({ timeout: 60000, pdfOptions: Fde.pdfOptions(exam, 'scheme') });
    expect(schemeOpts.pdfOptions.footerTemplate).not.toBe(paperOpts.pdfOptions.footerTemplate);
  });

  test('_layout.pages written from the PDF buffers', async () => {
    const out = await Orchestrator.buildPaper(PATTERN_JOB, {});
    const row = papers().find((r) => r.id === out.paperId);
    expect(row.status).toBe('ready');
    expect(row.exam_json._layout.pages).toEqual({ paper: 4, scheme: 6 });
    expect(out.examJson._layout.pages).toEqual({ paper: 4, scheme: 6 });
    // The scheme's box was printed knowing the paper's page count.
    const [, [schemeHtml]] = mockHtmlToPdf.mock.calls;
    expect(schemeHtml).toContain('(4 pages)');
    // The pages land in the same write that makes the row ready.
    const readyWrite = mockState.calls.find((c) => c.op === 'update' && c.payload && c.payload.status === 'ready');
    expect(readyWrite.payload.exam_json._layout.pages).toEqual({ paper: 4, scheme: 6 });
    expect(mockLog).toHaveBeenCalledWith('[assessment] pattern paper rendered',
      expect.objectContaining({ pattern: 'fde_g5_2027', pages: { paper: 4, scheme: 6 } }));
  });

  test('pdfPageCount ignores /Type /Pages and returns null for nothing', () => {
    expect(Orchestrator.pdfPageCount(fakePdf(3, 'x'))).toBe(3);
    expect(Orchestrator.pdfPageCount(Buffer.from('not a pdf'))).toBeNull();
    expect(Orchestrator.pdfPageCount(null)).toBeNull();
  });

  test('file names _FDE and _FDE_MarkingScheme', async () => {
    const out = await Orchestrator.buildPaper(PATTERN_JOB, {});
    const names = mockUpload.mock.calls.map(([a]) => a.filename);
    expect(names).toEqual(['Grade5_Maths_FDE.pdf', 'Grade5_Maths_FDE_MarkingScheme.pdf']);
    expect(out.filename).toBe('Grade5_Maths_FDE.pdf');
    const row = papers().find((r) => r.id === out.paperId);
    expect(row.file_r2_key).toBe('exams/teacher-1/Grade5_Maths_FDE.pdf');
    expect(row.answer_key_r2_key).toBe('exams/teacher-1/Grade5_Maths_FDE_MarkingScheme.pdf');
    // The scheme's box names the question paper, never its file (bd-5jmnfj.4.50.5).
    const [, [schemeHtml]] = mockHtmlToPdf.mock.calls;
    expect(schemeHtml).not.toContain('Grade5_Maths_FDE.pdf');
  });

  test('total_marks from _layout (100) not from the model\'s marks', async () => {
    // The model wrote 9 marks on every item; the layout's 100 stands.
    for (const list of Object.values(exam.unseen.subjective)) list.forEach((q) => { q.marks = 9; });
    const out = await Orchestrator.buildPaper(PATTERN_JOB, {});
    const row = papers().find((r) => r.id === out.paperId);
    expect(row.total_marks).toBe(100);
    expect(out.marks).toBe(100);
  });

  test('a PATTERN_SHORT_SLOT from generation fails the paper with that code and renders nothing', async () => {
    mockGeneratePatternExam.mockRejectedValue(Object.assign(new Error('maths.B.Q2 short by 2'), { code: 'PATTERN_SHORT_SLOT' }));
    const out = await Orchestrator.buildPaper(PATTERN_JOB, {});
    expect(out).toMatchObject({ status: 'failed', code: 'PATTERN_SHORT_SLOT' });
    expect(mockHtmlToPdf).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(papers()[0]).toMatchObject({ status: 'failed', error_code: 'PATTERN_SHORT_SLOT' });
  });

  test('a marking scheme that cannot be made fails the paper: two files are the promise', async () => {
    mockHtmlToPdf.mockImplementation(async (html) => {
      if (/class="record"/.test(html)) throw new Error('chromium died');
      return fakePdf(4, 'paper');
    });
    const out = await Orchestrator.buildPaper(PATTERN_JOB, {});
    expect(out).toMatchObject({ status: 'failed', code: 'RENDER_FAILED' });
    expect(papers()[0]).toMatchObject({ status: 'failed', error_code: 'RENDER_FAILED' });
  });

  test('the duplicate guard runs before generatePatternExam', async () => {
    mockState.rows.assessment_papers = [{
      id: 'paper-old', request_id: 'req-p', attempt: 1, edited_from: null, status: 'ready', file_r2_key: 'k',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }];
    const out = await Orchestrator.buildPaper(PATTERN_JOB, {});
    expect(out).toMatchObject({ status: 'ready', duplicate: true, paperId: 'paper-old' });
    expect(mockGeneratePatternExam).not.toHaveBeenCalled();
    expect(mockHtmlToPdf).not.toHaveBeenCalled();
  });

  test('the portal tail does not build a second key for a pattern paper', async () => {
    const out = await Orchestrator.process(PATTERN_JOB);
    expect(out.status).toBe('ready');
    expect(mockHtmlToPdf).toHaveBeenCalledTimes(2);
    expect(mockUpload).toHaveBeenCalledTimes(2);
  });

  test('WhatsApp sends the paper and the marking scheme already stored', async () => {
    const out = await Orchestrator.process({ ...PATTERN_JOB, deliver: 'whatsapp' });
    expect(out).toMatchObject({ status: 'ready', answerKeySent: true });
    expect(mockUpload).toHaveBeenCalledTimes(2);
    const sentNames = mockSendDocumentByLink.mock.calls.map((c) => c[2]);
    expect(sentNames).toEqual(['Grade5_Maths_FDE.pdf', 'Grade5_Maths_FDE_MarkingScheme.pdf']);
  });
});

describe('a board-pattern paper that comes back short', () => {
  const short = (slot, n) => Object.assign(new Error(`PATTERN_SHORT_SLOT: ${slot} short`), {
    code: 'PATTERN_SHORT_SLOT', shortfall: [{ slot, missing: n }], examJson: { unseen: {}, _layout: { slot } }, model: 'm',
  });

  test('is made once more, fresh, in the same row, and the second paper is the one that is ready', async () => {
    mockGeneratePatternExam.mockRejectedValueOnce(short('urdu.A.Q1', 1));
    const out = await Orchestrator.buildPaper(PATTERN_JOB, {});
    expect(out.status).toBe('ready');
    expect(mockGeneratePatternExam).toHaveBeenCalledTimes(2);
    // The second run is asked exactly what the first was: nothing the first held or kept rides along.
    const strip = ({ onSection, ...rest }) => rest;
    expect(strip(mockGeneratePatternExam.mock.calls[1][0])).toEqual(strip(mockGeneratePatternExam.mock.calls[0][0]));
    expect(mockGeneratePatternExam.mock.calls[1][0]).not.toBe(mockGeneratePatternExam.mock.calls[0][0]);
    expect(papers()).toHaveLength(1);
    expect(papers()[0]).toMatchObject({ id: out.paperId, status: 'ready' });
    expect(mockState.calls.some((c) => c.op === 'update' && c.payload && c.payload.status === 'failed')).toBe(false);
    expect(mockLog).toHaveBeenCalledWith('[assessment] pattern paper retried', expect.objectContaining({
      requestId: 'req-p', paperId: out.paperId, shortfall: [{ slot: 'urdu.A.Q1', missing: 1 }],
    }));
    expect(mockUpload).toHaveBeenCalledTimes(2);
  });

  test('short twice: the row fails with the second run\'s code and record, and there is no third run', async () => {
    mockGeneratePatternExam
      .mockRejectedValueOnce(short('urdu.A.Q1', 1))
      .mockRejectedValueOnce(short('urdu.B.Q2', 3));
    const out = await Orchestrator.buildPaper(PATTERN_JOB, {});
    expect(out).toMatchObject({ status: 'failed', code: 'PATTERN_SHORT_SLOT' });
    expect(mockGeneratePatternExam).toHaveBeenCalledTimes(2);
    expect(papers()[0]).toMatchObject({ status: 'failed', error_code: 'PATTERN_SHORT_SLOT' });
    expect(papers()[0].exam_json).toEqual({ unseen: {}, _layout: { slot: 'urdu.B.Q2' } });
    expect(mockLog).toHaveBeenCalledWith('[assessment] build failed', expect.objectContaining({
      code: 'PATTERN_SHORT_SLOT', shortfall: [{ slot: 'urdu.B.Q2', missing: 3 }],
    }));
    expect(mockHtmlToPdf).not.toHaveBeenCalled();
  });

  test('any other code is never retried', async () => {
    mockGeneratePatternExam.mockRejectedValueOnce(Object.assign(new Error('bad json'), { code: 'BAD_JSON' }));
    const out = await Orchestrator.buildPaper(PATTERN_JOB, {});
    expect(out).toMatchObject({ status: 'failed', code: 'BAD_JSON' });
    expect(mockGeneratePatternExam).toHaveBeenCalledTimes(1);
    expect(mockLog).not.toHaveBeenCalledWith('[assessment] pattern paper retried', expect.anything());
  });

  test('a row this run no longer owns (handed back) is not made again here', async () => {
    mockGeneratePatternExam.mockImplementationOnce(async () => {
      papers()[0].status = 'queued';
      throw short('urdu.A.Q1', 1);
    });
    const out = await Orchestrator.buildPaper(PATTERN_JOB, {});
    expect(out).toMatchObject({ status: 'failed', code: 'PATTERN_SHORT_SLOT' });
    expect(mockGeneratePatternExam).toHaveBeenCalledTimes(1);
  });
});

describe('a job without pattern', () => {
  test('never calls generatePatternExam and keeps today\'s file name and render call (no opts)', async () => {
    const out = await Orchestrator.process({ ...TODAY_JOB, deliver: 'none' });
    expect(out.status).toBe('ready');
    expect(mockGeneratePatternExam).not.toHaveBeenCalled();
    expect(mockGenerateExam).toHaveBeenCalledTimes(1);
    // Paper and key, each rendered with today's options only.
    expect(mockHtmlToPdf.mock.calls.map((c) => c[1])).toEqual([{ timeout: 60000 }, { timeout: 60000 }]);
    expect(mockUpload.mock.calls.map(([a]) => a.filename)).toEqual(['Grade5_Maths_Fractions.pdf', 'Grade5_Maths_Fractions_AnswerKey.pdf']);
    const row = papers()[0];
    expect(row.exam_json._layout).toBeUndefined();
    expect(row.total_marks).toBe(2);
  });
});
