/**
 * P1.2 (bd-1hae7.6) — the Tier-A connect context.
 *
 * What she gets asked about on a call is her OWN teaching, so the assistant has
 * to arrive already knowing her. This block is assembled at connect from our own
 * Supabase, and the rules it must obey are all failure-driven:
 *
 *  - **Every block soft-fails INDEPENDENTLY.** One slow table must not cost her
 *    the whole call — the block goes missing, the call proceeds.
 *  - **Every block carries its as-of date** (RT-5). Undated context gets spoken
 *    as if it were true today.
 *  - **It is TEXT, not scores.** The words — executive_summary, focus_area,
 *    strengths, recommendations — are what let her have a real conversation.
 *  - **Size-capped**, because a 20KB prompt is a slow, expensive call.
 *
 * The shapes here are the LIVE ones, verified against the staging DB on
 * 2026-08-24: analysis_data carries executive_summary / focus_area / strengths /
 * recommendations / growth_opportunities / domains / framework. There is NO
 * `prioritized_action` key, so nothing here depends on one.
 */

const { buildCallContext } = require('../../shared/calls/call-context.service');

const USER = {
  id: 'u-1', first_name: 'Ayesha', last_name: 'Khan', name: 'Ayesha Khan',
  school_name: 'Govt Girls Primary Rawal', grades_taught: ['4', '5'],
  subjects_taught: ['Maths'], preferred_language: 'ur', role: 'teacher',
};

const COACHING = {
  id: 'cs-9',
  completed_at: '2026-08-18T09:00:00Z',
  analysis_data: {
    framework: 'FICO',
    executive_summary: 'Strong questioning; pupils reasoned aloud in the second half.',
    focus_area: 'Wait time after open questions',
    strengths: ['Clear modelling on the board', 'Warm classroom tone'],
    recommendations: ['Pause three seconds after each open question', 'Ask a pupil to explain another pupil’s answer'],
    growth_opportunities: ['More pupil-to-pupil talk'],
    scores: { overall_percentage: 72 },
    domains: { classroom_culture: { narrative: 'settled and warm' } },
  },
};

const deps = (over = {}) => ({
  fetchUser: async () => USER,
  fetchLatestCoaching: async () => COACHING,
  fetchLpContext: async () => 'Recently delivered to this teacher: Grade 4 Maths — Ch 3 “Fractions” (2 days ago).',
  fetchUpcomingVisit: async () => ({ scheduled_at: '2026-08-27T05:00:00Z', observation_tool: 'FICO' }),
  fetchTraining: async () => ({ completed: 4, total: 12, latestTitle: 'Questioning for understanding' }),
  fetchMemory: async () => ({ summary: 'Last call she asked about fractions pacing.', updated_at: '2026-08-20T10:00:00Z', call_count: 2 }),
  now: () => new Date('2026-08-24T12:00:00Z'),
  ...over,
});

describe('call context — who she is', () => {
  test('names her, her school and what she teaches', async () => {
    const { block } = await buildCallContext({ from: '923001234567', deps: deps() });
    expect(block).toContain('Ayesha');
    expect(block).toContain('Govt Girls Primary Rawal');
    expect(block).toMatch(/Maths/);
    expect(block).toMatch(/4/);
  });

  test('an unknown caller still yields a usable, warm context', async () => {
    const { block, known } = await buildCallContext({
      from: '923009999999', deps: deps({ fetchUser: async () => null }),
    });
    expect(known).toBe(false);
    expect(block).toMatch(/not .{0,20}recognis|unknown|first time|no record/i);
    expect(block).not.toMatch(/undefined|null/);
  });

  test('her preferred language is reported so the persona can follow it', async () => {
    const { language } = await buildCallContext({ from: '92300', deps: deps() });
    expect(language).toBe('ur');
  });

  test('language falls back to Urdu when she has no preference stored', async () => {
    const { language } = await buildCallContext({
      from: '92300', deps: deps({ fetchUser: async () => ({ ...USER, preferred_language: null }) }),
    });
    expect(language).toBe('ur');
  });
});

describe('call context — the coaching, in WORDS', () => {
  test('carries the narrative fields, not just a number', async () => {
    const { block } = await buildCallContext({ from: '92300', deps: deps() });
    expect(block).toContain('Strong questioning');
    expect(block).toContain('Wait time after open questions');
    expect(block).toContain('Clear modelling on the board');
    expect(block).toContain('Pause three seconds');
  });

  test('does NOT put her score in the prompt (the no-measurement rule)', async () => {
    const { block } = await buildCallContext({ from: '92300', deps: deps() });
    expect(block).not.toMatch(/\b72\b/);
    expect(block).not.toMatch(/overall_percentage/);
  });

  test('a coaching row with no analysis_data is skipped, not half-rendered', async () => {
    const { block } = await buildCallContext({
      from: '92300', deps: deps({ fetchLatestCoaching: async () => ({ id: 'x', analysis_data: null }) }),
    });
    expect(block).not.toMatch(/COACHING/i);
    expect(block).toContain('Ayesha');
  });

  test('missing individual keys degrade gracefully', async () => {
    const { block } = await buildCallContext({
      from: '92300',
      deps: deps({ fetchLatestCoaching: async () => ({ completed_at: COACHING.completed_at, analysis_data: { focus_area: 'Wait time' } }) }),
    });
    expect(block).toContain('Wait time');
    expect(block).not.toMatch(/undefined|\[object Object\]/);
  });
});

describe('call context — as-of dating (RT-5)', () => {
  test('the coaching block says when it happened', async () => {
    const { block } = await buildCallContext({ from: '92300', deps: deps() });
    expect(block).toMatch(/2026-08-18|18 Aug|6 days ago/i);
  });

  test('the memory block says when it was written', async () => {
    const { block } = await buildCallContext({ from: '92300', deps: deps() });
    expect(block).toMatch(/2026-08-20|20 Aug|4 days ago/i);
  });

  test('no block is emitted undated', async () => {
    const { block } = await buildCallContext({ from: '92300', deps: deps() });
    block.split('\n').filter((l) => l.startsWith('## ')).forEach((heading) => {
      const section = block.slice(block.indexOf(heading), block.indexOf(heading) + 400);
      if (/COACHING|MEMORY|VISIT|LESSON/i.test(heading)) {
        expect(section).toMatch(/\d{4}-\d{2}-\d{2}|ago|today|tomorrow/i);
      }
    });
  });
});

describe('call context — every block fails independently (fail-open)', () => {
  const throwing = () => async () => { throw new Error('table unreachable'); };

  test('a coaching failure still leaves her identity and lessons', async () => {
    const { block } = await buildCallContext({ from: '92300', deps: deps({ fetchLatestCoaching: throwing() }) });
    expect(block).toContain('Ayesha');
    expect(block).toContain('Fractions');
  });

  test('an LP failure still leaves identity and coaching', async () => {
    const { block } = await buildCallContext({ from: '92300', deps: deps({ fetchLpContext: throwing() }) });
    expect(block).toContain('Ayesha');
    expect(block).toContain('Wait time');
  });

  test('EVERY source failing still returns a usable block, never a throw', async () => {
    const all = {
      fetchUser: throwing(), fetchLatestCoaching: throwing(), fetchLpContext: throwing(),
      fetchUpcomingVisit: throwing(), fetchTraining: throwing(), fetchMemory: throwing(),
    };
    const { block } = await buildCallContext({ from: '92300', deps: deps(all) });
    expect(typeof block).toBe('string');
    expect(block.length).toBeGreaterThan(0);
    expect(block).not.toMatch(/undefined|\[object Object\]/);
  });

  test('a hanging source does not hang the call — it is bounded by a timeout', async () => {
    const hang = () => new Promise(() => {}); // never settles
    const started = Date.now();
    const { block } = await buildCallContext({
      from: '92300', deps: deps({ fetchLatestCoaching: hang, timeoutMs: 50 }),
    });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(block).toContain('Ayesha');
  }, 10000);
});

describe('call context — the other blocks', () => {
  test('the upcoming visit is stated with its date', async () => {
    const { block } = await buildCallContext({ from: '92300', deps: deps() });
    expect(block).toMatch(/2026-08-27|27 Aug/i);
  });

  test('training position is stated as progress, not a grade', async () => {
    const { block } = await buildCallContext({ from: '92300', deps: deps() });
    expect(block).toMatch(/4.{0,6}12|4 of 12/);
    expect(block).toContain('Questioning for understanding');
  });

  test('rolling memory from previous calls is included', async () => {
    const { block } = await buildCallContext({ from: '92300', deps: deps() });
    expect(block).toContain('fractions pacing');
  });

  test('absent optional blocks are simply omitted', async () => {
    const { block } = await buildCallContext({
      from: '92300',
      deps: deps({ fetchUpcomingVisit: async () => null, fetchTraining: async () => null, fetchMemory: async () => null }),
    });
    expect(block).not.toMatch(/VISIT|TRAINING|PREVIOUS CALL/i);
    expect(block).toContain('Ayesha');
  });
});

describe('call context — size discipline', () => {
  test('is capped so a call is not slow and expensive to start', async () => {
    const huge = 'x'.repeat(50000);
    const { block } = await buildCallContext({
      from: '92300',
      deps: deps({ fetchLpContext: async () => huge, fetchLatestCoaching: async () => ({
        completed_at: COACHING.completed_at,
        analysis_data: { executive_summary: huge, strengths: [huge], recommendations: [huge] },
      }) }),
    });
    expect(block.length).toBeLessThanOrEqual(4500);
  });

  test('truncation is marked, never a silent cut mid-sentence', async () => {
    const { block } = await buildCallContext({
      from: '92300', deps: deps({ fetchLpContext: async () => 'y'.repeat(50000) }),
    });
    expect(block).toMatch(/…|\.\.\.|truncated/);
  });

  test('identity survives truncation — it is the block that matters most', async () => {
    const { block } = await buildCallContext({
      from: '92300', deps: deps({ fetchLpContext: async () => 'y'.repeat(50000) }),
    });
    expect(block).toContain('Ayesha');
  });
});

describe('call context — the snapshot for the audit trail (P3.1)', () => {
  test('returns which blocks were present and which failed', async () => {
    const { snapshot } = await buildCallContext({
      from: '92300', deps: deps({ fetchTraining: async () => { throw new Error('nope'); } }),
    });
    expect(snapshot.blocks.identity).toBe(true);
    expect(snapshot.blocks.coaching).toBe(true);
    expect(snapshot.blocks.training).toBe(false);
    expect(snapshot.failures).toContain('training');
  });

  test('records the user id it resolved, for joining the call row', async () => {
    const { snapshot, userId } = await buildCallContext({ from: '92300', deps: deps() });
    expect(userId).toBe('u-1');
    expect(snapshot.userId).toBe('u-1');
  });
});
