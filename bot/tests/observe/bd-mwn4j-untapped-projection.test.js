/**
 * bd-mwn4j — the untapped-reports sweep must never pull full analysis_data.
 *
 * The 24/25-Aug prod DB wedge: this query fetched up to 500 FULL analysis_data
 * JSONBs (transcripts + analyses, 100KB+ each) every 15 minutes. After the
 * photo-gate drip completed 224 fresh analyses the pulls began statement-timing
 * -out in bursts on the tick cadence (postgres_logs 17:13Z/17:28Z, resumed
 * 02:13Z post-restart) and the instance died OOM-class at ~17:45Z.
 *
 * Contract: select ONLY the teacher_delivery slice, filter server-side to rows
 * that have one, and classify from the aliased column.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const calls = { select: null, not: [], eq: [], limit: null };
const ROWS = [
  { id: 's-tap', teacher_delivery: { status: 'awaiting_teacher_tap', template_sent_at: '2026-08-20T05:00:00Z' } },
  { id: 's-sent', teacher_delivery: { status: 'sent' } },
];
jest.mock('../../shared/config/supabase', () => ({
  from: () => {
    const b = {
      select: (s) => { calls.select = s; return b; },
      eq: (k, v) => { calls.eq.push([k, v]); return b; },
      not: (k, op, v) => { calls.not.push([k, op, v]); return b; },
      order: () => b, lt: () => b, in: () => b,
      limit: (n) => { calls.limit = n; return Promise.resolve({ data: ROWS, error: null }); },
      then: (res) => Promise.resolve({ data: [], error: null }).then(res),
      single: () => Promise.resolve({ data: null, error: null }),
    };
    return b;
  },
}));
jest.mock('../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => true) }));
jest.mock('../../shared/services/coaching/coaching-job-queue.service', () => ({
  queueAnalysis: jest.fn(async () => 'mid'), queueReport: jest.fn(async () => 'mid'),
}), { virtual: true });
jest.mock('../../shared/services/soniox-cleanup.service', () => ({ runSonioxCleanup: jest.fn(async () => ({})) }), { virtual: true });
const mockProcessed = [];
jest.mock('../../shared/services/observe/observe-send.service', () => ({
  processUntappedDelivery: jest.fn(async (id) => { mockProcessed.push(id); return { action: 'nudge' }; }),
}), { virtual: true });

const { processUntappedReports } = require('../../workers/stale-session.worker');

test('the sweep selects ONLY the teacher_delivery slice — never the full analysis_data blob', async () => {
  await processUntappedReports();
  expect(calls.select).toBeTruthy();
  expect(calls.select).not.toMatch(/analysis_data\s*(,|$)/);   // no bare full-JSONB pull
  expect(calls.select).toMatch(/analysis_data->teacher_delivery/);
});

test('rows without a teacher_delivery are excluded server-side, not fetched-then-filtered', async () => {
  await processUntappedReports();
  expect(calls.not).toContainEqual(['analysis_data->teacher_delivery', 'is', null]);
});

test('classification reads the aliased slice and still processes candidates', async () => {
  mockProcessed.length = 0;
  const out = await processUntappedReports();
  expect(mockProcessed).toContain('s-tap');       // awaiting_teacher_tap → processed
  expect(out.total).toBeGreaterThanOrEqual(1);
});
