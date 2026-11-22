/**
 * bd-sy4kcv — her Digital Coach list (GET /teacher/coaching/history) while the lesson is NOT finished.
 *
 * The bot writes the scores at analysis_complete, before it asks the reflection question
 * (conducting_conversation) and before the report is made (generating_report). The list showed the
 * band ("Good", "Average") from that moment, so a lesson waiting on her answer read as finished.
 * Operator (2026-11-17): Analysing → Needs your answer → Preparing report → the band, only once completed.
 *
 *   · a PORTAL recording at conducting_conversation with a question unanswered → state needs_answer
 *     (a WhatsApp recording's question is answered in her chat; the portal has no box for it → no state);
 *   · generating_report → state preparing;
 *   · no percentage (so no band) until completed;
 *   · both still count as lessons she sent; only completed ones count as reports.
 */
const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const S = () => require('../../dashboard/services/teacher-coaching.service');

const PORTAL_AUDIO = `https://r2.example/classroom_audio/${TEACHER}/2026-11/portal_abc123.m4a`;
const WA_AUDIO = `https://r2.example/classroom_audio/${TEACHER}/2026-11/wamid_xyz.ogg`;
const SCORES = { overall_percentage: 64 };
const OPEN_Q = [{ question_number: 1, question: 'What did you notice when Ali answered?', answer: null }];
const ANSWERED_Q = [{ question_number: 1, question: 'What did you notice when Ali answered?', answer: 'He was unsure.' }];

function fakeQuery(rows) {
  const calls = [];
  const query = jest.fn(async (sql, params) => { calls.push({ sql, params }); return { rows: String(sql).includes('teacher-coaching:history') ? rows : [] }; });
  query.calls = calls;
  return query;
}
const row = (o) => ({ status: 'completed', failed_step: null, audio_duration_seconds: 1800, audio_url: PORTAL_AUDIO, questions: null, scores: SCORES, topic: null, subject: null, grade: null, ...o });
const RANGE = { key: 'all', from: null, to: null };
const byId = (out, id) => out.items.find((i) => i.id === id);

beforeEach(() => { jest.resetModules(); });

test('a portal lesson waiting on her reflection answer: Needs your answer, and no band yet', async () => {
  const out = await S().dcHistory(fakeQuery([
    row({ id: 'r', created_at: '2026-11-16T04:00:00Z', status: 'conducting_conversation', questions: OPEN_Q }),
  ]), TEACHER, { range: RANGE });
  expect(byId(out, 'r').state).toBe('needs_answer');
  expect(byId(out, 'r').percentage).toBeNull();
  expect(byId(out, 'r').reportReady).toBe(false);
});

test('her answer is in and the bot is on its next step: no state, no band', async () => {
  const out = await S().dcHistory(fakeQuery([
    row({ id: 'r', created_at: '2026-11-16T04:00:00Z', status: 'conducting_conversation', questions: ANSWERED_Q }),
  ]), TEACHER, { range: RANGE });
  expect(byId(out, 'r').state).toBeUndefined();
  expect(byId(out, 'r').percentage).toBeNull();
});

test('a WhatsApp lesson at its reflection question: answered in her chat, so not Needs your answer — and no band', async () => {
  const out = await S().dcHistory(fakeQuery([
    row({ id: 'w', created_at: '2026-11-16T04:00:00Z', status: 'conducting_conversation', audio_url: WA_AUDIO, questions: OPEN_Q }),
  ]), TEACHER, { range: RANGE });
  expect(byId(out, 'w').state).toBeUndefined();
  expect(byId(out, 'w').percentage).toBeNull();
});

test('the report is being made: Preparing report, no band', async () => {
  const out = await S().dcHistory(fakeQuery([
    row({ id: 'g', created_at: '2026-11-16T04:00:00Z', status: 'generating_report' }),
  ]), TEACHER, { range: RANGE });
  expect(byId(out, 'g').state).toBe('preparing');
  expect(byId(out, 'g').percentage).toBeNull();
});

test('scored but not yet asked (analysis_complete): no band', async () => {
  const out = await S().dcHistory(fakeQuery([
    row({ id: 'a', created_at: '2026-11-16T04:00:00Z', status: 'analysis_complete' }),
  ]), TEACHER, { range: RANGE });
  expect(byId(out, 'a').percentage).toBeNull();
});

test('completed: the band, as before; the unfinished ones still count as lessons, not as reports', async () => {
  const out = await S().dcHistory(fakeQuery([
    row({ id: 'r', created_at: '2026-11-16T04:00:00Z', status: 'conducting_conversation', questions: OPEN_Q }),
    row({ id: 'g', created_at: '2026-11-15T04:00:00Z', status: 'generating_report' }),
    row({ id: 'd', created_at: '2026-11-14T04:00:00Z' }),
  ]), TEACHER, { range: RANGE });
  expect(byId(out, 'd').percentage).toBe(64);
  expect(byId(out, 'd').state).toBeUndefined();
  expect(byId(out, 'd').reportReady).toBe(true);
  expect(out.kpis.sessions.value).toBe(3);
  expect(out.kpis.reports.value).toBe(1);
  expect(out.total).toBe(3);
});

test('the query reads the questions only, never the whole conversation_state', async () => {
  const query = fakeQuery([]);
  await S().dcHistory(query, TEACHER, { range: RANGE });
  const sql = query.calls[0].sql;
  expect(sql).toMatch(/conversation_state\s*->\s*'questions'/);
  expect(sql).not.toMatch(/conversation_state\s*(,|\s+AS\b|\n\s*FROM)/);
  expect(sql).toMatch(/audio_url/);
});
