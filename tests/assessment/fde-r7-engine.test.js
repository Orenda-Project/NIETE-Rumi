/**
 * Round-2 engine findings on board-pattern papers (fix-r7-engine).
 *
 * - maths.A.Q1a came back one or two short twice on sandbox although the re-ask ran: the re-ask
 *   REPLACED the section's reply, so the second draw had to be whole on its own. It now tops up.
 * - A failed pattern paper's row had exam_json null, so nobody could read what failed.
 * - "held item dropped" did not say which run matched or what kind of item it was.
 * - A review mark copied into an item failed the paper at render with no second try.
 *
 * Harness as fde-section-reask.test.js: the real orchestrator and generator, mocked at the edges.
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

const clone = (x) => JSON.parse(JSON.stringify(x));
const isA = (req) => req.messages.map((m) => JSON.stringify(m.content)).join('').includes('maths.A.Q1a');
const EQUAL = ['a) 1/2', 'b) 2/4', 'c) 1/3', 'd) 3/4'];

/** The maths fixture with the given Q1a MCQs carrying two options of equal value; `tag` relabels questions. */
function q1aSource(equalAt, tag = '') {
  const src = clone(FIXTURE);
  for (const types of Object.values(src.unseen)) {
    for (const list of Object.values(types)) {
      const mcqs = list.filter((q) => q.slot === 'maths.A.Q1a');
      mcqs.forEach((q, i) => {
        q.question = `${q.question}${tag}`;
        if (equalAt.includes(i)) { q.options = EQUAL.slice(); q.answer = 'c) 1/3'; }
      });
    }
  }
  return src;
}

describe('maths.A.Q1a: a re-ask tops the slot up instead of replacing the reply', () => {
  test('two equal-valued MCQs, then a re-ask with one → the slot is whole, first-reply items first', async () => {
    let aCalls = 0;
    const { Generation } = load((req) => {
      if (!isA(req)) return reply(FIXTURE, req);
      aCalls += 1;
      return aCalls === 1 ? reply(q1aSource([3, 9]), req) : reply(q1aSource([5], ' (again)'), req);
    });
    const out = await Generation.generatePatternExam(MATHS);
    expect(aCalls).toBe(2);
    const laid = state.logs.filter(([l]) => l === '[assessment] layout applied').map(([, d]) => d);
    expect(laid[0].shortfall).toEqual([]);
    expect(out.layout.placed).toBe(48);
    const q1a = [];
    const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object') { if (n.slot === 'maths.A.Q1a' && n.question) q1a.push(n); else Object.values(n).forEach(walk); } };
    walk(out.examJson.unseen);
    expect(q1a).toHaveLength(20);
    expect(q1a.filter((q) => !q.question.endsWith(' (again)'))).toHaveLength(18);
    // Billed once per call: A twice, B, C.
    expect(out.tokenData.inputTokens).toBe(4000);
  });
});

describe('a failed pattern paper keeps exam_json and model on its row', () => {
  test('PATTERN_SHORT_SLOT twice → row failed WITH exam_json and model', async () => {
    const { Orchestrator } = load((req) => reply(FIXTURE, req, (slot) => slot === 'maths.C.Q4-8'));
    const out = await Orchestrator.buildPaper({ userId: 'u1', ...MATHS }, {});
    expect(out).toMatchObject({ status: 'failed', code: 'PATTERN_SHORT_SLOT' });
    const row = state.rows.assessment_papers[0];
    expect(row.status).toBe('failed');
    expect(row.exam_json && typeof row.exam_json).toBe('object');
    expect(row.exam_json._layout).toBeTruthy();
    expect(typeof row.model).toBe('string');
    expect(row.model.length).toBeGreaterThan(0);
  });
});

describe('held item dropped: the log names the kind and the run that matched', () => {
  test('Social Studies held items log slot, kind and a 24-char match', async () => {
    const { Generation } = load((req) => reply(SST, req));
    await expect(Generation.generatePatternExam({ ...MATHS, subject: 'social_studies' })).rejects.toMatchObject({ code: 'PATTERN_SHORT_SLOT' });
    const held = state.logs.filter(([l]) => l === '[assessment] held item dropped').map(([, d]) => d);
    expect(held.length).toBeGreaterThan(0);
    held.forEach((d) => {
      expect(typeof d.kind).toBe('string');
      expect(d).toHaveProperty('slot');
      if (d.reason === 'lesson_1_3') expect(d.match).toHaveLength(24);
    });
  });
});

describe('REVIEW_TEXT in an item: that section is asked once more, then the paper fails', () => {
  const marked = (req) => {
    const r = reply(FIXTURE, req);
    const tree = JSON.parse(r.choices[0].message.content);
    const first = Object.values(tree.unseen)[0];
    const list = Object.values(first)[0];
    list[0] = { ...list[0], question: `${list[0].question} (needs review)` };
    r.choices[0].message.content = JSON.stringify(tree);
    return r;
  };

  test('a review mark in section C, clean on the re-ask → the paper is whole and clean', async () => {
    let cCalls = 0;
    const { Generation } = load((req) => {
      if (!isC(req)) return reply(FIXTURE, req);
      cCalls += 1;
      return cCalls === 1 ? marked(req) : reply(FIXTURE, req);
    });
    const out = await Generation.generatePatternExam(MATHS);
    expect(cCalls).toBe(2);
    expect(JSON.stringify(out.examJson)).not.toMatch(/needs review/i);
    const reasked = state.logs.filter(([l]) => l === '[assessment] section re-asked').map(([, d]) => d);
    expect(reasked).toEqual([expect.objectContaining({ section: 'C', reviewText: expect.objectContaining({ marker: expect.stringMatching(/needs review/) }) })]);
  });

  test('the mark again on the re-ask → REVIEW_TEXT, one re-ask only, row keeps exam_json', async () => {
    const { Generation } = load((req) => (isC(req) ? marked(req) : reply(FIXTURE, req)));
    await expect(Generation.generatePatternExam(MATHS)).rejects.toMatchObject({ code: 'REVIEW_TEXT', sections: ['C'] });
    expect(state.calls).toHaveLength(4);
  });
});

describe('an Urdu Q2 "questions" part with marks and no questions is a short slot', () => {
  const URDU = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'urdu.json'), 'utf8'));
  const isQ2 = (req) => req.messages.map((m) => JSON.stringify(m.content)).join('').includes('urdu.B.Q2');
  const emptied = () => {
    const src = clone(URDU);
    const walk = (n) => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === 'object') {
        if (n.slot === 'urdu.B.Q2') n.parts = n.parts.map((p) => (p.key === 'questions' ? { key: 'questions', marks: p.marks } : p));
        else Object.values(n).forEach(walk);
      }
    };
    walk(src);
    return src;
  };
  const URDU_ARGS = { ...MATHS, subject: 'urdu' };

  test('empty on the first reply, whole on the re-ask → the paper is whole', async () => {
    let q2Calls = 0;
    const { Generation } = load((req) => {
      if (!isQ2(req)) return reply(URDU, req);
      q2Calls += 1;
      return reply(q2Calls === 1 ? emptied() : URDU, req);
    });
    const out = await Generation.generatePatternExam(URDU_ARGS);
    expect(q2Calls).toBe(2);
    const reasked = state.logs.filter(([l]) => l === '[assessment] section re-asked').map(([, d]) => d);
    expect(reasked).toEqual([expect.objectContaining({ shortfall: [{ slot: 'urdu.B.Q2', part: 'questions', missing: 5 }] })]);
    let q2;
    const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object') { if (n.slot === 'urdu.B.Q2' && n.parts) q2 = n; else Object.values(n).forEach(walk); } };
    walk(out.examJson.unseen);
    expect(q2.parts.find((p) => p.key === 'questions').questions.length).toBeGreaterThan(0);
  });

  test('empty again on the re-ask → PATTERN_SHORT_SLOT naming the part', async () => {
    const { Generation } = load((req) => reply(isQ2(req) ? emptied() : URDU, req));
    await expect(Generation.generatePatternExam(URDU_ARGS)).rejects.toMatchObject({
      code: 'PATTERN_SHORT_SLOT', shortfall: [{ slot: 'urdu.B.Q2', part: 'questions', missing: 5 }],
    });
  });
});

describe('the top-up never treats two items without a question line as the same item', () => {
  test('first and second replies whose Q1a items carry no "question" (stem in "passage") still top up', async () => {
    const stemless = (src) => {
      const out = clone(src);
      for (const types of Object.values(out.unseen)) {
        for (const list of Object.values(types)) {
          list.filter((q) => q.slot === 'maths.A.Q1a').forEach((q) => { q.passage = q.question; delete q.question; });
        }
      }
      return out;
    };
    let aCalls = 0;
    const { Generation } = load((req) => {
      if (!isA(req)) return reply(FIXTURE, req);
      aCalls += 1;
      return aCalls === 1 ? reply(stemless(q1aSource([3, 9])), req) : reply(stemless(q1aSource([5], ' (again)')), req);
    });
    const out = await Generation.generatePatternExam(MATHS);
    expect(aCalls).toBe(2);
    expect(out.layout.placed).toBe(48);
  });
});

describe('a review mark in a marking-scheme point is caught before render too', () => {
  test('a mark in a scheme point of section C → that section is re-asked once', async () => {
    let cCalls = 0;
    const { Generation } = load((req) => {
      if (!isC(req)) return reply(FIXTURE, req);
      cCalls += 1;
      const r = reply(FIXTURE, req);
      if (cCalls === 1) {
        const tree = JSON.parse(r.choices[0].message.content);
        const list = Object.values(Object.values(tree.unseen)[0])[0];
        const q = list.find((x) => x.scheme && Array.isArray(x.scheme.points) && x.scheme.points.length);
        q.scheme.points[0] = { ...q.scheme.points[0], text: `${q.scheme.points[0].text} (needs review)` };
        r.choices[0].message.content = JSON.stringify(tree);
      }
      return r;
    });
    const out = await Generation.generatePatternExam(MATHS);
    expect(cCalls).toBe(2);
    expect(JSON.stringify(out.examJson)).not.toMatch(/needs review/i);
  });
});
