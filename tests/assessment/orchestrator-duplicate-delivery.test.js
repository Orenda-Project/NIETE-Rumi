/**
 * One request, one paper, one model call — even when the queue delivers the job twice.
 *
 * SQS delivers at least once. A worker that is stopped mid-paper (every deploy) hands its message
 * back, and a job that outlives its visibility window is handed to a second worker while the first
 * is still writing. The second run used to open the paper row, hit the unique index on
 * (request_id, attempt), never read that error, and call the model anyway: the paper was paid for
 * twice, the second copy was recorded nowhere, and on WhatsApp the teacher could be sent a
 * DIFFERENT paper from the one stored behind her Edit button. Measured since 30 Sep: eight requests
 * ran twice, five of them were left stuck in `generating`.
 *
 * The insert error is now read. Because the index is UNIQUE on generated rows, a successful insert
 * proves this is the first delivery, so nothing changes on the path every paper takes. Only when
 * the insert hits the index is the existing paper read, and then:
 *
 *   ready                       returned as it is, without a model call or a second send
 *   failed                      returned as it is: the first run already recorded and reported it
 *   generating, written < 10m   another run owns it: skipped, and the worker acks the message
 *   generating, silent >= 10m   its run died: this delivery takes the SAME row over and builds it
 *   unreadable                  as before the guard: build, without a row (never worse than today)
 */

const mockState = { rows: [], seq: 0, calls: [] };

function mockFakeDb() {
  const now = () => new Date().toISOString();
  function from(table) {
    const st = { table, op: 'select', payload: null, filters: [], order: null, limit: null, cols: '*' };
    const rows = () => (mockState.rows[table] ||= []);
    const match = (r) => st.filters.every(([k, op, v]) => (op === 'is' ? (v === null ? r[k] == null : r[k] === v) : r[k] === v));
    const run = () => {
      mockState.calls.push({ table, op: st.op, payload: st.payload, filters: st.filters.slice() });
      if (st.op === 'insert') {
        const p = st.payload;
        if (table === 'assessment_papers') {
          const clash = rows().find((r) => r.request_id === p.request_id && (r.attempt || 1) === (p.attempt || 1) && r.edited_from == null);
          if (clash) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_assessment_papers_request_attempt_generated"' } };
          }
        }
        mockState.seq += 1;
        const row = { id: `paper-new-${mockState.seq}`, attempt: 1, edited_from: null, created_at: now(), updated_at: now(), ...p };
        rows().push(row);
        return { data: row, error: null };
      }
      if (st.op === 'update') {
        rows().filter(match).forEach((r) => Object.assign(r, st.payload));
        return { data: null, error: null };
      }
      let hit = rows().filter(match);
      if (st.order) hit = hit.slice().sort((a, b) => (st.order.ascending ? 1 : -1) * ((a[st.order.col] || 0) - (b[st.order.col] || 0)));
      if (st.limit != null) hit = hit.slice(0, st.limit);
      return { data: hit, error: null };
    };
    const b = {
      insert: (p) => { st.op = 'insert'; st.payload = p; return b; },
      update: (p) => { st.op = 'update'; st.payload = p; return b; },
      select: (cols) => { st.cols = cols; return b; },
      eq: (k, v) => { st.filters.push([k, 'eq', v]); return b; },
      is: (k, v) => { st.filters.push([k, 'is', v]); return b; },
      order: (col, o = {}) => { st.order = { col, ascending: o.ascending !== false }; return b; },
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

const mockLoadChapterContent = jest.fn();
const mockGenerateExam = jest.fn();
const mockRender = jest.fn();
const mockUpload = jest.fn();
const mockSendDocumentByLink = jest.fn();
const mockSendMessage = jest.fn();
const mockLog = jest.fn();

jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadChapterContent: (...a) => mockLoadChapterContent(...a),
  loadPageRangeContent: (...a) => mockLoadChapterContent(...a),
}));
jest.mock('../../bot/shared/services/assessment/assessment-generation.service', () => ({
  generateExam: (...a) => mockGenerateExam(...a),
}));
jest.mock('../../bot/shared/services/assessment/assessment-format', () => ({
  rendererFor: () => ({ ext: 'pdf', render: (...a) => mockRender(...a) }),
}));
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
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));

const Orchestrator = require('../../bot/shared/services/assessment/assessment-orchestrator.service');

const JOB = {
  userId: 'teacher-1', requestId: 'req-1', grade: 5, subject: 'maths', chapterNumber: 2,
  questionTypes: [{ id: 'MCQs', count: 2, category: 'objective' }], contentSource: 'unseen', outputFormat: 'pdf',
};
const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();
const papers = () => mockState.rows.assessment_papers || [];
const logged = (line) => mockLog.mock.calls.some(([l]) => l === line);

function seedPaper(row) {
  mockState.rows.assessment_papers = mockState.rows.assessment_papers || [];
  mockState.rows.assessment_papers.push({ attempt: 1, edited_from: null, created_at: minutesAgo(1), updated_at: minutesAgo(1), ...row });
}

beforeEach(() => {
  mockState.rows = { users: [{ id: 'teacher-1', phone_number: 'wa-teacher-1', preferred_language: 'en', school_name: null }] };
  mockState.seq = 0;
  mockState.calls = [];
  jest.clearAllMocks();
  mockLoadChapterContent.mockResolvedValue({ content: '=== Page 12 ===\nFractions', pageReference: '12-20', chapterTitle: 'Fractions' });
  mockGenerateExam.mockResolvedValue({
    examJson: { unseen: { objective: { MCQs: [{ question: 'q1', marks: 1 }, { question: 'q2', marks: 1 }] } } },
    questionCount: 2, tokenData: { inputTokens: 10, outputTokens: 5, model: 'm' },
  });
  mockRender.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
  mockUpload.mockImplementation(async ({ filename }) => `exams/teacher-1/${filename}`);
  mockSendDocumentByLink.mockResolvedValue(true);
  mockSendMessage.mockResolvedValue(true);
});

describe('the first delivery is unchanged', () => {
  test('one insert, one model call, the new row ends ready', async () => {
    const out = await Orchestrator.buildPaper(JOB, {});
    expect(out.status).toBe('ready');
    expect(out.duplicate).toBeUndefined();
    expect(mockGenerateExam).toHaveBeenCalledTimes(1);
    expect(papers()).toHaveLength(1);
    expect(papers()[0]).toMatchObject({ id: out.paperId, status: 'ready' });
    // No read of the papers table before the insert: the happy path makes the calls it always made.
    const paperCalls = mockState.calls.filter((c) => c.table === 'assessment_papers').map((c) => c.op);
    expect(paperCalls[0]).toBe('insert');
    expect(paperCalls).not.toContain('select');
  });
});

describe('orchestrator: a second delivery of the same request', () => {
  test('orchestrator: second run of a ready request returns the paper without a model call', async () => {
    seedPaper({ id: 'paper-1', request_id: 'req-1', status: 'ready', file_r2_key: 'exams/teacher-1/x.pdf', question_count: 2, total_marks: 2 });
    const out = await Orchestrator.buildPaper(JOB, {});
    expect(out).toMatchObject({ status: 'ready', duplicate: true, paperId: 'paper-1', key: 'exams/teacher-1/x.pdf', questionCount: 2, marks: 2 });
    expect(mockGenerateExam).not.toHaveBeenCalled();
    expect(mockRender).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(papers()).toHaveLength(1);
    expect(logged('[assessment] duplicate delivery skipped')).toBe(true);
  });

  test('on WhatsApp it sends nothing a second time: no paper, no key, no apology', async () => {
    seedPaper({ id: 'paper-1', request_id: 'req-1', status: 'ready', file_r2_key: 'exams/teacher-1/x.pdf', question_count: 2, total_marks: 2 });
    const out = await Orchestrator.process({ ...JOB, deliver: 'whatsapp' });
    expect(out).toMatchObject({ status: 'ready', duplicate: true, paperId: 'paper-1' });
    expect(mockSendDocumentByLink).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockGenerateExam).not.toHaveBeenCalled();
  });

  test('for the app it builds no second key and calls no model', async () => {
    seedPaper({ id: 'paper-1', request_id: 'req-1', status: 'ready', file_r2_key: 'exams/teacher-1/x.pdf', question_count: 2, total_marks: 2 });
    const out = await Orchestrator.process({ ...JOB, deliver: 'none' });
    expect(out).toMatchObject({ status: 'ready', duplicate: true, paperId: 'paper-1' });
    expect(mockRender).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockGenerateExam).not.toHaveBeenCalled();
  });

  test('a failed request stays failed: no model call, and the teacher is not told twice', async () => {
    seedPaper({ id: 'paper-1', request_id: 'req-1', status: 'failed', error_code: 'BAD_JSON' });
    const out = await Orchestrator.process({ ...JOB, deliver: 'whatsapp' });
    expect(out).toMatchObject({ status: 'failed', duplicate: true, code: 'BAD_JSON', paperId: 'paper-1' });
    expect(mockGenerateExam).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  test('a paper another run is writing (written to in the last 10 min) is skipped, not written twice', async () => {
    seedPaper({ id: 'paper-1', request_id: 'req-1', status: 'generating', created_at: minutesAgo(3), updated_at: minutesAgo(3) });
    const out = await Orchestrator.process({ ...JOB, deliver: 'whatsapp' });
    expect(out).toMatchObject({ status: 'skipped', duplicate: true, paperId: 'paper-1' });
    expect(mockGenerateExam).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockSendDocumentByLink).not.toHaveBeenCalled();
    expect(papers()[0].status).toBe('generating');
    expect(logged('[assessment] duplicate delivery skipped')).toBe(true);
  });

  test('a paper whose run went silent 10 min ago is taken over: the SAME row is built, once', async () => {
    seedPaper({ id: 'paper-1', request_id: 'req-1', status: 'generating', created_at: minutesAgo(16), updated_at: minutesAgo(16) });
    const out = await Orchestrator.process({ ...JOB, deliver: 'whatsapp' });
    expect(out).toMatchObject({ status: 'ready', paperId: 'paper-1' });
    expect(mockGenerateExam).toHaveBeenCalledTimes(1);
    expect(papers()).toHaveLength(1);
    expect(papers()[0]).toMatchObject({ id: 'paper-1', status: 'ready' });
    expect(mockSendDocumentByLink).toHaveBeenCalled();
    expect(logged('[assessment] taking over a stale paper')).toBe(true);
  });

  test('taking a row over marks it as being written now, so a third delivery skips it', async () => {
    seedPaper({ id: 'paper-1', request_id: 'req-1', status: 'generating', created_at: minutesAgo(16), updated_at: minutesAgo(16) });
    let releaseModel;
    mockGenerateExam.mockImplementationOnce(() => new Promise((resolve) => { releaseModel = resolve; }));
    const first = Orchestrator.buildPaper(JOB, {});
    await new Promise((r) => setImmediate(r));
    const third = await Orchestrator.buildPaper(JOB, {});
    expect(third).toMatchObject({ status: 'skipped', duplicate: true, paperId: 'paper-1' });
    releaseModel({ examJson: { unseen: { objective: { MCQs: [{ question: 'q', marks: 1 }] } } }, questionCount: 1, tokenData: {} });
    await expect(first).resolves.toMatchObject({ status: 'ready', paperId: 'paper-1' });
    expect(mockGenerateExam).toHaveBeenCalledTimes(1);
  });
});

describe('the guard never makes a paper worse off than before it', () => {
  test('an insert that fails for another reason builds as before, without a row', async () => {
    const db = require('../../bot/shared/config/supabase');
    const realFrom = db.from;
    db.from = (t) => {
      const b = realFrom(t);
      if (t !== 'assessment_papers') return b;
      const insert = b.insert;
      b.insert = (p) => { insert(p); b.single = async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }); return b; };
      return b;
    };
    try {
      const out = await Orchestrator.buildPaper(JOB, {});
      expect(out.status).toBe('ready');
      expect(mockGenerateExam).toHaveBeenCalledTimes(1);
      expect(out.paperId).toBeNull();
      expect(mockLog).toHaveBeenCalledWith('[assessment] could not open paper row — continuing',
        expect.objectContaining({ requestId: 'req-1', error: expect.stringContaining('statement timeout') }));
    } finally {
      db.from = realFrom;
    }
  });

  test('a clash whose existing row cannot be read builds as before, without a row', async () => {
    seedPaper({ id: 'paper-1', request_id: 'req-1', status: 'ready' });
    const db = require('../../bot/shared/config/supabase');
    const realFrom = db.from;
    db.from = (t) => {
      const b = realFrom(t);
      if (t !== 'assessment_papers') return b;
      b.is = () => { throw new Error('column assessment_papers.edited_from does not exist'); };
      return b;
    };
    try {
      const out = await Orchestrator.buildPaper(JOB, {});
      expect(out.status).toBe('ready');
      expect(out.paperId).toBeNull();
      expect(mockGenerateExam).toHaveBeenCalledTimes(1);
    } finally {
      db.from = realFrom;
    }
  });
});

describe('_existingPaperFor', () => {
  test('is exported for the board-pattern branch', () => {
    expect(typeof Orchestrator._existingPaperFor).toBe('function');
  });

  test('finds the generated paper, never an edited version of it', async () => {
    seedPaper({ id: 'paper-v2', request_id: 'req-1', status: 'ready', edited_from: 'paper-1', created_at: minutesAgo(1) });
    seedPaper({ id: 'paper-1', request_id: 'req-1', status: 'ready', created_at: minutesAgo(30) });
    await expect(Orchestrator._existingPaperFor('req-1')).resolves.toMatchObject({ id: 'paper-1', status: 'ready' });
  });

  test('null when the request has no paper yet', async () => {
    await expect(Orchestrator._existingPaperFor('req-none')).resolves.toBeNull();
  });
});
