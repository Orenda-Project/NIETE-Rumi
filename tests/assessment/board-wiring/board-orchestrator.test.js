/**
 * A G9-12 board job through the real buildPaper (bd-5jmnfj.38.25.3): the generator is mocked to return a
 * fictional SSC-I physics paper; the real orchestrator prints it and its marking scheme with the board
 * renderers and board-render/print.js footers, stores both as _FBISE files, and writes the board total.
 * Edges mocked: database, PDF engine, storage, generator.
 */
const F = require('../board-render/_fixtures');

let state;

function fakeDb() {
  function from(table) {
    const st = { op: 'select', payload: null, eq: {} };
    const rows = () => (state.rows[table] ||= []);
    const run = () => {
      if (st.op === 'insert') {
        state.seq += 1;
        const row = { id: `${table}-${state.seq}`, attempt: 1, edited_from: null, created_at: new Date().toISOString(), ...st.payload };
        rows().push(row);
        return { data: row, error: null };
      }
      if (st.op === 'update') {
        rows().filter((r) => Object.entries(st.eq).every(([k, v]) => r[k] === v))
          .forEach((r) => Object.assign(r, JSON.parse(JSON.stringify(st.payload))));
        return { data: null, error: null };
      }
      if (table === 'app_settings') return { data: null, error: null };
      return { data: [], error: null };
    };
    const b = {
      select: () => b, insert: (p) => { st.op = 'insert'; st.payload = p; return b; },
      update: (p) => { st.op = 'update'; st.payload = p; return b; },
      eq: (k, v) => { st.eq[k] = v; return b; }, is: () => b, in: () => b, gte: () => b, order: () => b, limit: () => b,
      single: async () => run(), maybeSingle: async () => run(),
      then: (ok, ko) => Promise.resolve(run()).then(ok, ko),
    };
    return b;
  }
  return { from };
}

const fakePdf = (pages) => Buffer.from(`%PDF-1.7\n1 0 obj <</Type /Pages /Count ${pages}>>\n${'<</Type /Page /Parent 1 0 R>>\n'.repeat(pages)}%%EOF`, 'latin1');

function load(exam) {
  jest.resetModules();
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: (...a) => state.logs.push(a), logError: jest.fn(), logWarn: jest.fn() }));
  jest.doMock('../../../bot/shared/config/supabase', () => fakeDb());
  jest.doMock('../../../bot/shared/utils/html-to-pdf', () => ({
    htmlToPdf: async (html, opts) => { state.pdfs.push({ html, opts }); return state.pdfs.length === 1 ? fakePdf(6) : fakePdf(3); },
  }));
  jest.doMock('../../../bot/shared/storage/r2', () => ({
    uploadExamBuffer: async ({ filename }) => { state.uploads.push(filename); return `exams/u1/${filename}`; },
    buildR2PublicUrl: (k) => k,
  }));
  const Generation = require('../../../bot/shared/services/assessment/assessment-generation.service');
  jest.spyOn(Generation, 'generatePatternExam').mockImplementation(async () => ({
    examJson: exam, questionCount: 68, pageReference: '1-40', tokenData: { model: 'm', inputTokens: 1, outputTokens: 1 },
  }));
  state.fde = require('../../../bot/shared/services/assessment/assessment-paper-fde.renderer');
  state.frames = jest.spyOn(state.fde, 'framePages').mockImplementation(async () => ({ q1: 2 }));
  return require('../../../bot/shared/services/assessment/assessment-orchestrator.service');
}

const JOB = {
  userId: 'u-fictional-teacher-1', requestId: 'req-board', grade: 9, subject: 'physics', pattern: 'fbise_ssc1_2027',
  scope: { kind: 'chapters', chapters: [1, 2], pages: '1-40' }, pageRanges: '1-40',
};

beforeEach(() => { state = { rows: {}, seq: 0, logs: [], pdfs: [], uploads: [] }; });

test('a board paper is printed with board footers, stored as FBISE files, and totals its sections', async () => {
  const exam = F.fbise50();
  const declared = exam._layout.sections.reduce((n, s) => n + s.marks, 0);
  const Orchestrator = load(exam);
  const out = await Orchestrator.buildPaper(JOB, {});
  expect(out).toMatchObject({ status: 'ready', marks: declared });

  expect(state.pdfs).toHaveLength(2);
  const [paper, scheme] = state.pdfs;
  expect(paper.html).not.toContain('{n}');
  expect(scheme.html).toContain('Marking Scheme');
  expect(paper.opts.pdfOptions.footerTemplate).toContain('Page <span class="pageNumber"></span> of <span class="totalPages"></span>');
  expect(paper.opts.pdfOptions.footerTemplate).not.toContain('Marking Scheme');
  expect(scheme.opts.pdfOptions.footerTemplate).toContain('Marking Scheme · Page');

  expect(state.uploads).toEqual(['Grade9_physics_FBISE.pdf', 'Grade9_physics_FBISE_MarkingScheme.pdf']);
  const row = state.rows.assessment_papers[0];
  expect(row.status).toBe('ready');
  expect(row.total_marks).toBe(declared);
  expect(row.exam_json._layout.pages).toEqual({ paper: 6, scheme: 3 });
  expect(row.exam_json._layout.frame_pages).toBeUndefined();
  expect(state.frames).not.toHaveBeenCalled();
});

test('an FDE paper still goes through the FDE printer: FDE footers, frames and total, filed as FDE', async () => {
  const exam = { _layout: { profile: 'fde', sections: [], slots: [] } };
  const Orchestrator = load(exam);
  const R = require('../../../bot/shared/services/assessment/assessment-paper.renderer');
  jest.spyOn(R, 'renderPaper').mockReturnValue('<html>paper</html>');
  jest.spyOn(R, 'renderAnswerKey').mockReturnValue('<html>scheme</html>');
  jest.spyOn(state.fde, 'pdfOptions').mockImplementation((e, kind) => ({ fde: kind }));
  jest.spyOn(state.fde, 'totalMarks').mockReturnValue(100);
  const out = await Orchestrator.buildPaper({ ...JOB, grade: 5, subject: 'maths', pattern: 'fde_g5_2027' }, {});
  expect(out).toMatchObject({ status: 'ready', marks: 100 });
  expect(state.pdfs.map((p) => p.opts.pdfOptions)).toEqual([{ fde: 'paper' }, { fde: 'scheme' }]);
  expect(state.frames).toHaveBeenCalledTimes(1);
  expect(state.uploads).toEqual(['Grade5_Maths_FDE.pdf', 'Grade5_Maths_FDE_MarkingScheme.pdf']);
  expect(state.rows.assessment_papers[0].exam_json._layout.frame_pages).toEqual({ q1: 2 });
});

test('an Urdu-medium board paper gets the right-to-left Urdu footer', async () => {
  const Orchestrator = load(F.urdu());
  const out = await Orchestrator.buildPaper({ ...JOB, subject: 'urdu' }, {});
  expect(out.status).toBe('ready');
  expect(state.pdfs[0].opts.pdfOptions.footerTemplate).toContain('dir="rtl"');
  expect(state.pdfs[0].opts.pdfOptions.footerTemplate).toContain('صفحہ <span class="pageNumber">');
});
