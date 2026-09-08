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

const mockCalls = { select: null, not: [], eq: [], is: [], order: [], limit: null, range: null };
const mockROWS = [
  {
    id: 's-tap',
    teacher_delivery: {
      status: 'awaiting_teacher_tap',
      // Inside the age ceiling, so the planner still says "nudge" (bd-n6fl1).
      template_sent_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
  },
  { id: 's-sent', teacher_delivery: { status: 'sent' } },
];
let mockServed = false;
jest.mock('../../shared/config/supabase', () => ({
  from: () => {
    const b = {
      select: (s) => { mockCalls.select = s; return b; },
      eq: (k, v) => { mockCalls.eq.push([k, v]); return b; },
      not: (k, op, v) => { mockCalls.not.push([k, op, v]); return b; },
      is: (k, v) => { mockCalls.is.push([k, v]); return b; },
      order: (k, o) => { mockCalls.order.push([k, o]); return b; },
      lt: () => b, in: () => b,
      limit: (n) => { mockCalls.limit = n; return b; },
      // bd-n6fl1: the sweep now PAGES. One page of rows, then an empty page, so
      // the loop terminates the way it does against a real PostgREST.
      range: (a, z) => {
        mockCalls.range = [a, z];
        const page = mockServed ? [] : mockROWS;
        mockServed = true;
        return Promise.resolve({ data: page, error: null });
      },
      then: (res) => Promise.resolve({ data: [], error: null }).then(res),
      single: () => Promise.resolve({ data: null, error: null }),
    };
    return b;
  },
}));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  acquireLock: jest.fn(async () => true),
  releaseLock: jest.fn(async () => true),
}), { virtual: true });
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

beforeEach(() => { mockServed = false; mockCalls.order.length = 0; mockCalls.is.length = 0; });

test('the sweep selects ONLY the teacher_delivery slice — never the full analysis_data blob', async () => {
  await processUntappedReports();
  expect(mockCalls.select).toBeTruthy();
  expect(mockCalls.select).not.toMatch(/analysis_data\s*(,|$)/);   // no bare full-JSONB pull
  expect(mockCalls.select).toMatch(/analysis_data->teacher_delivery/);
});

test('rows without a teacher_delivery are excluded server-side, not fetched-then-filtered', async () => {
  await processUntappedReports();
  expect(mockCalls.not).toContainEqual(['analysis_data->teacher_delivery', 'is', null]);
});

test('classification reads the aliased slice and still processes candidates', async () => {
  mockProcessed.length = 0;
  const out = await processUntappedReports();
  expect(mockProcessed).toContain('s-tap');       // awaiting_teacher_tap → processed
  expect(out.total).toBeGreaterThanOrEqual(1);
});
