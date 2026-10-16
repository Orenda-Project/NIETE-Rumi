/**
 * A pattern paper that comes back short says which request and which slot, in one log line.
 *
 * A slot left short fails the paper (PATTERN_SHORT_SLOT), and the error carries the slots and how
 * many items each is missing. The orchestrator's `build failed` line used to drop that, so finding
 * out WHICH slot failed meant re-running the paper. It now carries the request id and the
 * shortfall, and the request id reaches the generator's own section and layout lines.
 *
 * The real orchestrator and the real generator; mocked at the edges only: the database, the book
 * text and the model.
 */
const fs = require('fs');
const path = require('path');

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

const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'maths.json'), 'utf8'));

/** Each section from the worked maths paper, with Section B two word problems short. */
function shortReply(req) {
  const prompt = req.messages[1].content;
  const tree = { unseen: {} };
  for (const [category, types] of Object.entries(FIXTURE.unseen)) {
    for (const [type, list] of Object.entries(types)) {
      let mine = list.filter((q) => prompt.includes(`"slot": "${q.slot}"`));
      if (type === 'Word Problems') mine = mine.slice(0, 10);
      if (mine.length) ((tree.unseen[category] ||= {})[type] = mine);
    }
  }
  return { choices: [{ message: { content: JSON.stringify(tree) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } };
}

function load() {
  jest.resetModules();
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => state.logs.push(a), logError: jest.fn(), logWarn: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => fakeDb());
  jest.doMock('../../bot/shared/services/assessment/book-content.service', () => ({
    loadPageRangeContent: async ({ pageRanges }) => ({
      content: '=== Page 5 ===\nPlace value.\n\n=== Page 100 ===\nDecimals.\n\n=== Page 220 ===\nAngles.\n\n=== Page 255 ===\nAverages.',
      pageReference: String(pageRanges), chapterTitle: null,
    }),
    loadChapterContent: async () => { throw new Error('not used'); },
  }));
  jest.doMock('../../bot/shared/services/llm-client', () => ({
    getClient: () => ({ chat: { completions: { create: async (req) => shortReply(req) } } }),
  }));
  return require('../../bot/shared/services/assessment/assessment-orchestrator.service');
}

beforeEach(() => { state = { rows: {}, seq: 0, logs: [] }; });

test('build failed carries requestId and the shortfall', async () => {
  const Orchestrator = load();
  const out = await Orchestrator.buildPaper({
    userId: 'u1', requestId: 'req-short', grade: 5, subject: 'maths',
    pattern: 'fde_g5_2027', scope: { kind: 'fde', chapters: null, pages: null },
  }, {});
  expect(out).toMatchObject({ status: 'failed', code: 'PATTERN_SHORT_SLOT' });

  const failed = state.logs.filter(([l]) => l === '[assessment] build failed').map(([, d]) => d);
  expect(failed).toHaveLength(1);
  expect(failed[0]).toMatchObject({ requestId: 'req-short', code: 'PATTERN_SHORT_SLOT', shortfall: [{ slot: 'maths.B.Q2', missing: 2 }] });

  // The request id reaches the generator's own lines.
  // Three sections, and Section B asked once more before the paper fails.
  const sections = state.logs.filter(([l]) => l === '[assessment] generating').map(([, d]) => d);
  expect(sections).toHaveLength(4);
  sections.forEach((d) => expect(d.requestId).toBe('req-short'));
  expect(state.logs.find(([l]) => l === '[assessment] layout applied')[1].requestId).toBe('req-short');
});
