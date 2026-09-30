/**
 * The backfill that turns every paper edited the old way into two versions.
 *
 * P (the edited row) keeps its id — old WhatsApp messages, portal links and its
 * `_Edited` PDF all point at it — and becomes version 2. A new row, version 1,
 * is inserted from `original_exam_json` with a DETERMINISTIC id (UUIDv5 of
 * P.id), so a crash half-way is healed by simply running again.
 *
 * The unique index V1.5.6 creates covers roots only (edited_from IS NULL). P is
 * a root until it is patched, and v1 is a root with P's attempt — so v1 is
 * inserted at attempt+1000 first, P is patched to point at it, and only then is
 * v1 given its real attempt. Without that order the very first insert fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const Script = require('../../bot/scripts/assessment/backfill-paper-versions');
const Selection = require('../../bot/shared/services/assessment/assessment-selection');

// --- a tiny in-memory PostgREST ------------------------------------------------
function makeDb(rows) {
  const table = { assessment_papers: rows, users: [{ id: 'u1', school_name: 'School' }] };
  const writes = [];
  const from = (name) => {
    const st = { name, filters: [], op: 'select', payload: null, opts: null, limit: null };
    const match = (r) => st.filters.every(([k, op, v]) => {
      const x = k.includes('.') ? undefined : r[k];
      if (op === 'eq') return x === v;
      if (op === 'is') return v === null ? x == null : x === v;
      if (op === 'notnull') return x != null;
      if (op === 'gt') return String(x) > String(v);
      if (op === 'gte') return Number(x) >= Number(v);
      return true;
    });
    const exec = () => {
      const t = table[st.name];
      if (st.op === 'select') {
        let out = t.filter(match).sort((a, b) => (a.id < b.id ? -1 : 1));
        if (st.limit) out = out.slice(0, st.limit);
        return { data: out.map((r) => JSON.parse(JSON.stringify(r))), error: null };
      }
      if (st.op === 'upsert') {
        writes.push({ op: 'upsert', table: st.name, row: st.payload });
        if (t.some((r) => r.id === st.payload.id)) return { data: null, error: null };
        // the partial unique index: roots only
        const clash = st.payload.edited_from == null && t.some((r) => r.edited_from == null
          && r.request_id === st.payload.request_id && r.attempt === st.payload.attempt);
        if (clash) return { data: null, error: { message: 'duplicate key uq_assessment_papers_request_attempt_generated' } };
        t.push(JSON.parse(JSON.stringify(st.payload)));
        return { data: null, error: null };
      }
      if (st.op === 'update') {
        const hit = t.filter(match);
        writes.push({ op: 'update', table: st.name, ids: hit.map((r) => r.id), patch: st.payload });
        hit.forEach((r) => Object.assign(r, JSON.parse(JSON.stringify(st.payload))));
        return { data: null, error: null };
      }
      return { data: null, error: null };
    };
    const b = {
      select: () => b,
      eq: (k, v) => { st.filters.push([k, 'eq', v]); return b; },
      is: (k, v) => { st.filters.push([k, 'is', v]); return b; },
      not: (k, _op, v) => { if (v === null) st.filters.push([k, 'notnull']); return b; },
      gt: (k, v) => { st.filters.push([k, 'gt', v]); return b; },
      gte: (k, v) => { st.filters.push([k, 'gte', v]); return b; },
      order: () => b,
      limit: (n) => { st.limit = n; return b; },
      maybeSingle: () => Promise.resolve({ data: exec().data?.[0] || null, error: null }),
      upsert: (p, o) => { st.op = 'upsert'; st.payload = p; st.opts = o; return b; },
      update: (p) => { st.op = 'update'; st.payload = p; return b; },
      then: (res, rej) => Promise.resolve(exec()).then(res, rej),
    };
    return b;
  };
  return { client: { from }, table, writes };
}

const q = (text, extra = {}) => ({ question: text, answer: `a-${text}`, lines: 0, main_question: 'Do.', marks: 1, ...extra });
const ORIGINAL = { seen: { objective: { MCQs: [q('M1', { options: ['A) 1', 'B) 2'] }), q('M2', { options: ['A) 3', 'B) 4'] })], 'Fill in the blanks': [q('F1'), q('F2')] } } };
const SELECTED = ['seen.objective.Fill in the blanks.0', 'seen.objective.Fill in the blanks.1'];
const EDITED = (() => { const t = Selection.applySelection(JSON.parse(JSON.stringify(ORIGINAL)), SELECTED); t.seen.objective['Fill in the blanks'][1].question = 'F2 edited'; return JSON.parse(JSON.stringify(t)); })();
const REQ = { user_id: 'u1', grade_code: 'grade_3', subject_code: 'maths', chapter_number: null, textbook_id: null, output_format: 'pdf', page_ranges: '1-4' };

const P_ID = '11111111-1111-4111-8111-111111111111';
const rowP = (over = {}) => ({
  id: P_ID, request_id: 'r1', attempt: 1, status: 'ready', edited_at: '2026-09-01T00:00:00Z', edited_from: null,
  exam_json: EDITED, original_exam_json: ORIGINAL, selected_question_ids: SELECTED,
  question_count: 2, total_marks: 2, file_r2_key: `exams/u1/${P_ID}/Grade3_Maths_Edited.pdf`,
  answer_key_r2_key: `exams/u1/${P_ID}/Grade3_Maths_AnswerKey.pdf`, model: 'm', input_tokens: 1, output_tokens: 2,
  created_at: '2026-08-31T00:00:00Z', ready_at: '2026-08-31T00:01:00Z', assessment_requests: REQ, ...over,
});

function deps(db, extra = {}) {
  return {
    supabase: db.client,
    r2: {
      listKeys: jest.fn(async (prefix) => [`${prefix}Grade3_Maths.pdf`, `${prefix}Grade3_Maths_Edited.pdf`, `${prefix}Grade3_Maths_AnswerKey.pdf`]),
      uploadExamBuffer: jest.fn(async ({ userId, examId, filename }) => `exams/${userId}/${examId}/${filename}`),
    },
    rendererFor: () => ({ ext: 'pdf', render: jest.fn(async () => Buffer.from('pdf')) }),
    log: () => {},
    env: { SUPABASE_URL: 'https://olvritwoqujtjvwfulbh.supabase.co' },
    ...extra,
  };
}

describe('uuidv5', () => {
  test('matches the RFC 4122 test vector (DNS namespace, "www.example.com")', () => {
    expect(Script.uuidv5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'))
      .toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });
});

describe('backfill-paper-versions', () => {
  test('a dry run writes nothing and reports the mode counts', async () => {
    const db = makeDb([rowP()]);
    const out = await Script.run([], deps(db));
    expect(db.writes).toEqual([]);
    expect(out.dryRun).toBe(true);
    expect(out.counts).toMatchObject({ aligned: 1, edit_only: 0, fallback: 0, errors: 0 });
  });

  test('--yes refuses to write without the expected project ref, and with the wrong one', async () => {
    const db = makeDb([rowP()]);
    await expect(Script.run(['--yes'], deps(db))).rejects.toThrow(/--expect-ref/);
    await expect(Script.run(['--yes', '--expect-ref', 'ihzciabopbttygxxgrkm'], deps(db))).rejects.toThrow(/ref/);
    expect(db.writes).toEqual([]);
  });

  test('--yes inserts v1 with the uuidv5 id, patches P to point at it, and neither collides on the root index', async () => {
    const db = makeDb([rowP()]);
    const out = await Script.run(['--yes', '--expect-ref', 'olvritwoqujtjvwfulbh'], deps(db));
    const v1Id = Script.v1IdFor(P_ID);
    const v1 = db.table.assessment_papers.find((r) => r.id === v1Id);
    const p = db.table.assessment_papers.find((r) => r.id === P_ID);
    expect(out.counts.errors).toBe(0);
    expect(v1).toMatchObject({
      request_id: 'r1', attempt: 1, status: 'ready',
      exam_json: ORIGINAL, file_r2_key: `exams/u1/${P_ID}/Grade3_Maths.pdf`,
      answer_key_r2_key: `exams/u1/${P_ID}/Grade3_Maths_AnswerKey.pdf`,
      created_at: '2026-08-31T00:00:00Z', ready_at: '2026-08-31T00:01:00Z', question_count: 4,
    });
    expect(v1.edited_from == null).toBe(true);
    expect(p.edited_from).toBe(v1Id);
    // P's tree is the full original with her edit in and the trimmed ones flagged
    const items = Selection.indexQuestions(p.exam_json);
    expect(items.filter((i) => i.removed).map((i) => i.text)).toEqual(['M1', 'M2']);
    expect(items.find((i) => i.text === 'F2 edited')).toBeTruthy();
    expect(p.answer_key_r2_key).toBeNull(); // the old key was built from the ORIGINAL
    // the old columns are left for V1.5.7
    expect(p.original_exam_json).toEqual(ORIGINAL);
    expect(p.selected_question_ids).toEqual(SELECTED);
    // P never becomes anything but "ready" and its file never moves
    expect(p.status).toBe('ready');
    expect(p.file_r2_key).toBe(`exams/u1/${P_ID}/Grade3_Maths_Edited.pdf`);
  });

  test('a second run inserts nothing', async () => {
    const db = makeDb([rowP()]);
    const d = deps(db);
    await Script.run(['--yes', '--expect-ref', 'olvritwoqujtjvwfulbh'], d);
    const n = db.table.assessment_papers.length;
    db.writes.length = 0;
    const again = await Script.run(['--yes', '--expect-ref', 'olvritwoqujtjvwfulbh'], d);
    expect(db.table.assessment_papers).toHaveLength(n);
    expect(db.writes.filter((w) => w.op === 'upsert')).toEqual([]);
    expect(again.counts.selected).toBe(0);
  });

  test('a crash after P was patched but before v1 got its real attempt is healed on the next run', async () => {
    const db = makeDb([rowP()]);
    const v1Id = Script.v1IdFor(P_ID);
    db.table.assessment_papers.push({ ...rowP({ id: v1Id, attempt: 1001, exam_json: ORIGINAL }), edited_at: null });
    db.table.assessment_papers[0].edited_from = v1Id;
    const out = await Script.run(['--yes', '--expect-ref', 'olvritwoqujtjvwfulbh'], deps(db));
    expect(out.counts.healed).toBe(1);
    expect(db.table.assessment_papers.find((r) => r.id === v1Id).attempt).toBe(1);
  });

  test('a rebuilt tree that would print differently falls back to the stored tree, untouched', async () => {
    const db = makeDb([rowP()]);
    const Renderer = require('../../bot/shared/services/assessment/assessment-paper.renderer');
    let n = 0;
    const out = await Script.run(['--yes', '--expect-ref', 'olvritwoqujtjvwfulbh'], deps(db, {
      Renderer: { ...Renderer, renderPaper: (a) => `${Renderer.renderPaper(a)}${(n += 1)}` },
    }));
    expect(out.counts).toMatchObject({ aligned: 0, fallback: 1 });
    expect(db.table.assessment_papers.find((r) => r.id === P_ID).exam_json).toEqual(EDITED);
  });

  test('--render-keys builds v2\'s key from its own active questions and stores it', async () => {
    const db = makeDb([rowP()]);
    const d = deps(db);
    await Script.run(['--yes', '--render-keys', '--expect-ref', 'olvritwoqujtjvwfulbh'], d);
    const p = db.table.assessment_papers.find((r) => r.id === P_ID);
    expect(p.answer_key_r2_key).toMatch(new RegExp(`^exams/u1/${P_ID}/.*_v2_AnswerKey\\.pdf$`));
    expect(d.r2.uploadExamBuffer).toHaveBeenCalledTimes(1);
  });

  test('--manifest records the inserted v1 ids and the patched P ids', async () => {
    const db = makeDb([rowP()]);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ag-')), 'manifest.json');
    await Script.run(['--yes', '--expect-ref', 'olvritwoqujtjvwfulbh', '--manifest', file], deps(db));
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(m.inserted).toEqual([Script.v1IdFor(P_ID)]);
    expect(m.patched).toEqual([P_ID]);
    expect(m.ref).toBe('olvritwoqujtjvwfulbh');
  });

  test('an edited paper with no original kept is skipped and counted, not guessed', async () => {
    const db = makeDb([rowP({ original_exam_json: null })]);
    const out = await Script.run(['--yes', '--expect-ref', 'olvritwoqujtjvwfulbh'], deps(db));
    expect(out.counts.no_original).toBe(1);
    expect(db.writes).toEqual([]);
  });
});
