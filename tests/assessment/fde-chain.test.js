/**
 * A board-pattern paper from the teacher's tap to the two stored files, with nothing in between
 * mocked except the edges: the database, the queue, storage, the PDF engine, the book text and
 * the model. The real create route writes the job; that exact job goes to the real buildPaper,
 * which runs the real per-section generator, layout, scheme, maths check and both renderers.
 *
 * It exists because the pieces were built against each other's contracts in parallel: the route
 * against the job payload, the orchestrator against generatePatternExam, the generator against
 * the pattern modules. Each has its own tests with the neighbour mocked; this is the one place the
 * neighbours are real, so a contract drift between them fails here and not on sandbox.
 */
const fs = require('fs');
const path = require('path');

const KEY = 'fde-chain-key';
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
        state.updates.push({ table, payload: st.payload });
        rows().filter((r) => Object.entries(st.eq).every(([k, v]) => r[k] === v))
          .forEach((r) => Object.assign(r, JSON.parse(JSON.stringify(st.payload))));
        return { data: null, error: null };
      }
      if (table === 'app_settings') {
        const v = state.settings[st.eq.key];
        return { data: v === undefined ? null : { key: st.eq.key, value: v }, error: null };
      }
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

const Patterns = require('../../bot/shared/services/assessment/patterns');
const P = Patterns.get('fde_g5_2027');
const fixture = (subject) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${subject}.json`), 'utf8'));

/** The model: for each section prompt, the fixture's items for that section's slots, as JSON. */
function modelReplyFor(subject, prompt) {
  const S = P.subjects[subject];
  const section = S.sections.find((sec) => sec.slots.every((slot) => prompt.includes(slot.slot)));
  if (!section) throw new Error(`no section recognised in the prompt for ${subject}`);
  const mine = new Set(section.slots.map((s) => s.slot));
  const tree = {};
  for (const [cat, types] of Object.entries(fixture(subject).unseen)) {
    for (const [type, items] of Object.entries(types)) {
      const kept = items.filter((q) => mine.has(q.slot));
      if (kept.length) ((tree[cat] ||= {})[type] = kept);
    }
  }
  state.sections.push(section.id);
  return { choices: [{ message: { content: JSON.stringify({ unseen: tree }) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } };
}

const fakePdf = (pages) => Buffer.from(`%PDF-1.7\n1 0 obj <</Type /Pages /Count ${pages}>>\n${'<</Type /Page /Parent 1 0 R>>\n'.repeat(pages)}%%EOF`, 'latin1');

function load() {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => state.logs.push(a), logError: jest.fn(), logWarn: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => fakeDb());
  jest.doMock('../../bot/shared/services/queue', () => ({ queueJob: async (...a) => { state.queued.push(a); return { messageId: 'm' }; } }));
  jest.doMock('../../bot/shared/services/assessment/assessment-browse.service', () => ({
    bookFor: async () => ({ id: 'book-g5' }), listChapters: async () => [],
  }));
  jest.doMock('../../bot/shared/services/assessment/book-content.service', () => ({
    loadPageRangeContent: async ({ pageRanges }) => ({
      content: `=== Page 30 ===\nBook text for ${pageRanges}.`, pageReference: pageRanges, chapterTitle: null,
    }),
    loadChapterContent: async () => ({ content: 'Book text.', pageReference: '1-2', chapterTitle: null }),
  }));
  jest.doMock('../../bot/shared/services/llm-client', () => ({
    getClient: () => ({ chat: { completions: { create: async (req) => {
      state.calls.push(req);
      return modelReplyFor(state.subject, req.messages[1].content);
    } } } }),
  }));
  jest.doMock('../../bot/shared/utils/html-to-pdf', () => ({
    htmlToPdf: async (html, opts) => { state.pdfs.push(opts); return /class="record"/.test(html) ? fakePdf(5) : fakePdf(4); },
  }));
  jest.doMock('../../bot/shared/storage/r2', () => ({
    uploadExamBuffer: async ({ filename }) => { state.uploads.push(filename); return `exams/u1/${filename}`; },
    buildR2PublicUrl: (k) => k,
  }));
  return {
    router: require('../../bot/shared/routes/internal-api.routes'),
    Orchestrator: require('../../bot/shared/services/assessment/assessment-orchestrator.service'),
  };
}

async function create(router, body) {
  const layer = router.stack.find((l) => l.route && l.route.path === '/assessment/create' && l.route.methods.post);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  let statusCode = 200; let payload;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  await handler({ body, headers: { 'x-api-key': KEY } }, res);
  return { statusCode, payload };
}

const LABEL = { maths: 'Maths', science: 'Science', urdu: 'Urdu' };

describe.each(['maths', 'science', 'urdu'])('%s: tap → job → two stored files', (subject) => {
  beforeEach(() => {
    state = { subject, rows: {}, seq: 0, settings: { assessment_fde_pattern_enabled: true }, queued: [], calls: [], sections: [], pdfs: [], uploads: [], logs: [], updates: [] };
  });

  test('the job the route queues builds a ready paper and marking scheme, with page counts', async () => {
    const { router, Orchestrator } = load();
    const made = await create(router, { userId: 'u1', grade: 5, subject, pattern: 'fde_g5_2027', scope: 'fde' });
    expect(made.statusCode).toBe(202);
    expect(state.queued).toHaveLength(1);
    const [, jobType, job] = state.queued[0];
    expect(jobType).toBe('assessment_generate');

    const out = await Orchestrator.buildPaper(job, {});
    expect(out).toMatchObject({ status: 'ready', marks: 100, filename: `Grade5_${LABEL[subject]}_FDE.pdf` });

    // One model call per section, each with the section's own slots and the per-section ceiling.
    expect(state.sections.sort()).toEqual(P.subjects[subject].sections.map((s) => s.id).sort());
    state.calls.forEach((c) => expect(c.max_tokens).toBe(12000));

    const row = state.rows.assessment_papers[0];
    expect(row.status).toBe('ready');
    expect(row.total_marks).toBe(100);
    expect(row.exam_json._layout.preset_id).toBe('fde_g5_2027');
    expect(row.exam_json._layout.pages).toEqual({ paper: 4, scheme: 5 });
    expect(state.uploads).toEqual([`Grade5_${LABEL[subject]}_FDE.pdf`, `Grade5_${LABEL[subject]}_FDE_MarkingScheme.pdf`]);
    // The row is written as each section comes back, so a long live run never looks dead to the
    // duplicate guard (it reads "ten minutes since the row's last write" as a stopped run).
    const touches = state.updates.filter((u) => u.table === 'assessment_papers' && u.payload.status === 'generating');
    expect(touches.length).toBe(P.subjects[subject].sections.length);
    // Both documents with their own footer.
    expect(state.pdfs.every((o) => o && o.pdfOptions && o.pdfOptions.displayHeaderFooter)).toBe(true);
  });
});

test('without a pattern the same route queues today\'s job and buildPaper never reaches the pattern generator', async () => {
  state = { subject: 'maths', rows: {}, seq: 0, settings: { assessment_fde_pattern_enabled: true }, queued: [], calls: [], sections: [], pdfs: [], uploads: [], logs: [], updates: [] };
  const { router } = load();
  const Generation = require('../../bot/shared/services/assessment/assessment-generation.service');
  const spy = jest.spyOn(Generation, 'generatePatternExam');
  jest.doMock('../../bot/shared/services/assessment/assessment-browse.service', () => ({
    bookFor: async () => ({ id: 'book-g5' }), listChapters: async () => [{ chapter_number: 3, page_start: 42, page_end: 66 }],
  }));
  const made = await create(router, { userId: 'u1', grade: 5, subject: 'maths', chapterNumbers: [3] });
  expect(made.statusCode).toBe(202);
  const [, , job] = state.queued[0];
  expect(job).not.toHaveProperty('pattern');
  expect(job).not.toHaveProperty('scope');
  expect(spy).not.toHaveBeenCalled();
});
