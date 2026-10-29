/**
 * A board-pattern section that comes back short is asked once more before the paper fails.
 *
 * On sandbox, 20 of 21 failed pattern papers were PATTERN_SHORT_SLOT, almost all the same hole: a
 * Maths Section C reply with the whole Q4–8 block missing. A teacher then got "Came out wrong"
 * after two minutes and made the whole paper again. Now the sections holding a short slot are
 * asked once more, and the paper fails only if the second reply is short too. The re-ask runs
 * BEFORE the held-content filter, so an item the filter drops is still never refilled.
 *
 * Also here: a paper a stopping worker has handed back (`queued`) is never flipped back to
 * `generating` by the run that was stopped, and the held-item log names its request.
 *
 * The real orchestrator and generator; mocked at the edges only: the database, the book text and
 * the model.
 */
const fs = require('fs');
require('./helpers/skip-giveaway-check'); // recorded replies hold real give-aways (bd-5jmnfj.4.51.3)
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
        rows().filter((r) => Object.entries(st.eq).every(([k, v]) => r[k] === v)).forEach((r) => {
          if (r.status === 'queued' && st.payload.status === 'generating') state.rewrites.push(r.id);
          Object.assign(r, JSON.parse(JSON.stringify(st.payload)));
        });
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
const SST = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'r6-sst-held.json'), 'utf8'));

/** The section's own items from a worked paper; `drop(slot)` true leaves that slot out. */
function reply(source, req, drop = () => false) {
  const prompt = req.messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((p) => p.text).join(''))).join('\n');
  const tree = { unseen: {} };
  for (const [category, types] of Object.entries(source.unseen)) {
    for (const [type, list] of Object.entries(types)) {
      const mine = list.filter((q) => prompt.includes(`"slot": "${q.slot}"`) && !drop(q.slot));
      if (mine.length) ((tree.unseen[category] ||= {})[type] = mine);
    }
  }
  return { choices: [{ message: { content: JSON.stringify(tree) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } };
}

const isC = (req) => req.messages.map((m) => JSON.stringify(m.content)).join('').includes('maths.C.Q4-8');

function load(create) {
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
    getClient: () => ({ chat: { completions: { create: async (req) => { state.calls.push(req); return create(req); } } } }),
  }));
  return {
    Generation: require('../../bot/shared/services/assessment/assessment-generation.service'),
    Orchestrator: require('../../bot/shared/services/assessment/assessment-orchestrator.service'),
  };
}

beforeEach(() => { state = { rows: {}, seq: 0, logs: [], calls: [], rewrites: [] }; });

const MATHS = { grade: 5, subject: 'maths', pattern: 'fde_g5_2027', scope: { kind: 'fde', chapters: null, pages: null }, requestId: 'req-1' };

describe('a short section is asked once more', () => {
  test('Maths C with Q4–8 missing, then whole on the re-ask → the paper is whole', async () => {
    let cCalls = 0;
    const { Generation } = load((req) => {
      if (!isC(req)) return reply(FIXTURE, req);
      cCalls += 1;
      return reply(FIXTURE, req, (slot) => cCalls === 1 && slot === 'maths.C.Q4-8');
    });
    const out = await Generation.generatePatternExam(MATHS);
    expect(cCalls).toBe(2);
    expect(state.calls).toHaveLength(4); // A, B, C, and C once more
    const reasked = state.logs.filter(([l]) => l === '[assessment] section re-asked').map(([, d]) => d);
    expect(reasked).toEqual([expect.objectContaining({ requestId: 'req-1', section: 'C', shortfall: [expect.objectContaining({ slot: 'maths.C.Q4-8' })] })]);
    expect(out.examJson._layout.total_marks).toBe(100);
    // The re-ask is billed: four calls' tokens.
    expect(out.tokenData.inputTokens).toBe(4000);
  });

  test('short again on the re-ask → PATTERN_SHORT_SLOT, and only one re-ask', async () => {
    const { Generation } = load((req) => reply(FIXTURE, req, (slot) => slot === 'maths.C.Q4-8'));
    await expect(Generation.generatePatternExam(MATHS)).rejects.toMatchObject({ code: 'PATTERN_SHORT_SLOT' });
    expect(state.calls).toHaveLength(4);
  });

  test('a whole paper is never re-asked', async () => {
    const { Generation } = load((req) => reply(FIXTURE, req));
    await Generation.generatePatternExam(MATHS);
    expect(state.calls).toHaveLength(3);
    expect(state.logs.some(([l]) => l === '[assessment] section re-asked')).toBe(false);
  });

  test('a held item is never refilled: Social Studies with the Sermon items fails, and no section is re-asked for them', async () => {
    const { Generation } = load((req) => reply(SST, req));
    await expect(Generation.generatePatternExam({ ...MATHS, subject: 'social_studies' })).rejects.toMatchObject({ code: 'PATTERN_SHORT_SLOT' });
    const sections = require('../../bot/shared/services/assessment/patterns').get('fde_g5_2027').subjects.social_studies.sections.length;
    // The only re-asks are for Q5/Q7 items the layout set aside for re-asking a Q1 fact (round 9)
    // and Q6 items answered with a Q5 item's points (round 13); Section A, where a Sermon item is
    // the only loss, is never asked again.
    const reasked = state.logs.filter(([l]) => l === '[assessment] section re-asked').map(([, d]) => d);
    // Round 15: D may be asked once more before a held D item is put back.
    expect([...new Set(reasked.map((d) => d.section))].sort()).toEqual(['C', 'D']);
    expect(reasked.filter((d) => d.section === 'D').length).toBeLessThanOrEqual(2);
    reasked.forEach((d) => d.shortfall.forEach((f) => expect(['social_studies.C.Q5', 'social_studies.D.Q6', 'social_studies.D.Q7']).toContain(f.slot)));
    expect(state.calls).toHaveLength(sections + reasked.length);
    const held = state.logs.filter(([l]) => l === '[assessment] held item dropped').map(([, d]) => d);
    expect(held.length).toBeGreaterThan(0);
    held.forEach((d) => expect(d.requestId).toBe('req-1'));
  });
});

describe('a handed-back paper stays handed back', () => {
  test('the stopped run does not flip a queued paper back to generating', async () => {
    const { Orchestrator } = load((req) => {
      // The worker stopping mid-run: the paper is handed back while the model is still writing.
      const paper = (state.rows.assessment_papers || [])[0];
      if (paper && state.calls.length === 1) paper.status = 'queued';
      return reply(FIXTURE, req);
    });
    await Orchestrator.buildPaper({ userId: 'u1', ...MATHS }, {}).catch(() => {});
    expect(state.rewrites).toEqual([]);
  });
});
