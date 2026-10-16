'use strict';
/**
 * A storybook the teacher sent to the class (quizzes.quiz_source = 'story') is not a quiet lesson: the morning
 * "only N children have started" message never names it and never stamps it, so it can neither ride along with a
 * lesson's nudge nor be silenced by one. The lesson nudge itself is unchanged.
 *
 * Only the network boundary is mocked: Supabase (a small in-memory chain that applies the filters, JSON paths
 * included) and WhatsApp.
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
}));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Nudge = require('../../bot/shared/services/quiz/transcript-quiz-nudge.service');

const TEACHER = 'teacher-1';
/** A UTC instant for a PKT wall-clock time on a September 2026 day. */
const pkt = (day, h, m = 0) => new Date(Date.UTC(2026, 8, day, h - 5, m));

/** Read a column the way PostgREST does, `meta->>sent_at` included. */
function valueAt(row, col) {
  const m = /^(\w+)->>(\w+)$/.exec(col);
  if (!m) return row[col];
  const v = (row[m[1]] || {})[m[2]];
  return v === undefined || v === null ? null : String(v);
}

function memoryDb(tables) {
  return (name) => {
    const filters = [];
    let patch = null;
    let limitN = null;
    const rows = () => (tables[name] || []).filter((r) => filters.every((f) => f(r)));
    const run = () => {
      if (patch) {
        const hit = rows();
        for (const r of hit) Object.assign(r, JSON.parse(JSON.stringify(patch)));
        return { data: hit, error: null };
      }
      const out = rows();
      return { data: limitN === null ? out : out.slice(0, limitN), error: null };
    };
    const api = {
      select: () => api,
      update: (p) => { patch = p; return api; },
      eq: (c, v) => { filters.push((r) => valueAt(r, c) === v); return api; },
      is: (c, v) => { filters.push((r) => (v === null ? valueAt(r, c) == null : valueAt(r, c) === v)); return api; },
      in: (c, vs) => { filters.push((r) => vs.includes(valueAt(r, c))); return api; },
      gte: (c, v) => { filters.push((r) => valueAt(r, c) != null && valueAt(r, c) >= v); return api; },
      order: () => api,
      limit: (n) => { limitN = n; return api; },
      maybeSingle: async () => { const r = run(); return { data: r.data[0] || null, error: null }; },
      single: async () => { const r = run(); return { data: r.data[0] || null, error: null }; },
      then: (ok, bad) => Promise.resolve(run()).then(ok, bad),
    };
    return api;
  };
}

/** A quiz made on `madeDay`, sent at 01:00 PKT on 20 Sep, nobody started. */
function oldQuiz(id, topic, madeDay) {
  return {
    id, teacher_id: TEACHER, topic, status: 'sent', language: 'en',
    created_at: pkt(madeDay, 11).toISOString(),
    meta: { sent_at: pkt(20, 1).toISOString() },
  };
}

let tables;
beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.NUDGE_QUIET_HOURS_PKT;
  tables = {
    quizzes: [
      oldQuiz('q-a', 'Fractions', 8),
      oldQuiz('q-b', 'Nouns', 10),
      { ...oldQuiz('q-story', 'The Kite Testwala', 14), quiz_source: 'story', meta: { sent_at: pkt(20, 1).toISOString(), story: { book_id: 'b-1', lang: 'en' } } },
    ],
    quiz_sessions: [],
    users: [{ id: TEACHER, phone_number: '000000000004', preferred_language: 'en' }],
  };
  supabase.from.mockImplementation(memoryDb(tables));
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
});

afterEach(() => jest.useRealTimers());

async function processAt(when, quizId) {
  jest.setSystemTime(when);
  return Nudge.process(quizId);
}

describe('a storybook send next to quiet lessons', () => {
  test('the morning message names the lessons, never the story, and never stamps the story', async () => {
    await processAt(pkt(20, 7, 12), 'q-a');

    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    const body = WhatsAppService.sendMessage.mock.calls[0][1];
    expect(body).toMatch(/Fractions/);
    expect(body).toMatch(/Nouns/);
    expect(body).not.toMatch(/Kite Testwala/);
    expect(tables.quizzes.find((q) => q.id === 'q-story').meta.nudged_at).toBeUndefined();
  });
});
