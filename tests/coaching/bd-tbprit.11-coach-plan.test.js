'use strict';
/**
 * bd-tbprit.11 — Rifat's "Coaching suggestion" box, the server half. Amena's four answers (20 Oct):
 *   1 "The teacher was right" flags the report for the DC team — stored on the request (coach_plan), Undo clears it
 *   2 the template shows at once; the AI-tailored version replaces it when ready; a failed AI leaves the template
 *   3 "Add to my next visit" is stored on the request too
 *   4 the WhatsApp send is a wa.me link — only the fact that it was opened is stored, never the text
 *
 *   savePlan       her own request only; a whitelist of keys; timestamps stamped here, never taken from the page
 *   publicPlan     what the card shows: no AI cache, no timestamps beyond what the box needs
 *   parseSuggestion the model's JSON, or null when any part is missing or the wrong shape
 *   suggestionFor  cached per answer and language in coach_plan.ai; the model sees no teacher name; null on failure
 */
const { savePlan, publicPlan, parseSuggestion, suggestionFor } = require('../../dashboard/services/coach-disagreement-plan');

const NOW = new Date('2026-10-26T10:00:00Z');

/** supabase-js stand-in for one table, coach_visit_requests. */
function fakeSupabase(rows, opts = {}) {
  const writes = [];
  const from = () => {
    const q = { filters: [], patch: null };
    const keep = (r) => q.filters.every(([k, v]) => r[k] === v);
    const run = () => {
      const hit = rows.filter(keep);
      if (q.patch) { writes.push(q.patch); hit.forEach((r) => Object.assign(r, q.patch)); }
      return hit;
    };
    const chain = {
      select() { return chain; },
      update(p) { q.patch = p; return chain; },
      eq(k, v) { q.filters.push([k, v]); return chain; },
      maybeSingle() { return Promise.resolve({ data: run()[0] || null, error: null }); },
      then(res, rej) {
        if (q.patch && opts.failWrite) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(res, rej);
        return Promise.resolve({ data: run(), error: null }).then(res, rej);
      },
    };
    return chain;
  };
  return { from, writes };
}
const ROW = (extra) => ({ id: 'r1', coach_user_id: 'me', coach_plan: null, ...extra });

const GOOD = {
  msg: '{name} جی، شکریہ۔', qs: ['q1', 'q2', 'q3'], stuck: ['s1', 's2'], agree: 'a', check: 'c', visit: ['v1', 'v2', 'v3'],
};

describe('savePlan', () => {
  it('her answer and way are saved', async () => {
    const row = ROW();
    const plan = await savePlan(fakeSupabase([row]), 'me', 'r1', { found: 2, mode: 'visit' }, NOW);
    expect(row.coach_plan).toMatchObject({ found: 2, mode: 'visit' });
    expect(plan).toEqual({ found: 2, mode: 'visit', flagged: false, addedToVisit: false, sent: false });
  });

  it('"The teacher was right" flags the report, stamped here; Undo clears the flag', async () => {
    const row = ROW();
    const sb = fakeSupabase([row]);
    await savePlan(sb, 'me', 'r1', { found: 0, flagged: true }, NOW);
    expect(row.coach_plan).toMatchObject({ found: 0, flagged: true, flaggedAt: NOW.toISOString() });
    const plan = await savePlan(sb, 'me', 'r1', { flagged: false }, NOW);
    expect(row.coach_plan).toMatchObject({ found: 0, flagged: false, flaggedAt: null });
    expect(plan.flagged).toBe(false);
  });

  it('"Add to my next visit" and the WhatsApp link opened are stamped; earlier choices and the AI cache are kept', async () => {
    const row = ROW({ coach_plan: { found: 1, mode: 'call', ai: { en1: GOOD } } });
    const sb = fakeSupabase([row]);
    await savePlan(sb, 'me', 'r1', { addedToVisit: true }, NOW);
    const plan = await savePlan(sb, 'me', 'r1', { sent: true }, NOW);
    expect(row.coach_plan).toMatchObject({
      found: 1, mode: 'call', addedToVisitAt: NOW.toISOString(), sentAt: NOW.toISOString(), ai: { en1: GOOD },
    });
    expect(plan).toEqual({ found: 1, mode: 'call', flagged: false, addedToVisit: true, sent: true });
  });

  it('anything off the whitelist is dropped: unknown keys, a found of 4, a mode of "sms", a page-sent timestamp, the message text', async () => {
    const row = ROW();
    await savePlan(fakeSupabase([row]), 'me', 'r1', {
      found: 4, mode: 'sms', flaggedAt: '1999-01-01', draft: 'Sadia جی', ai: { en0: GOOD }, role: 'admin',
    }, NOW);
    expect(row.coach_plan).toEqual({});
  });

  it('found as a string is not a number; flagged as "yes" is not a boolean', async () => {
    const row = ROW();
    await savePlan(fakeSupabase([row]), 'me', 'r1', { found: '1', flagged: 'yes' }, NOW);
    expect(row.coach_plan).toEqual({});
  });

  it("another coach's request, or no request: null and nothing written", async () => {
    const row = ROW({ coach_user_id: 'someone' });
    const sb = fakeSupabase([row]);
    expect(await savePlan(sb, 'me', 'r1', { found: 1 }, NOW)).toBeNull();
    expect(await savePlan(sb, 'me', 'nope', { found: 1 }, NOW)).toBeNull();
    expect(sb.writes).toEqual([]);
  });

  it('a failed write throws, never a false "saved"', async () => {
    await expect(savePlan(fakeSupabase([ROW()], { failWrite: true }), 'me', 'r1', { found: 1 }, NOW)).rejects.toThrow('boom');
  });
});

describe('publicPlan', () => {
  it('null stays null; the AI cache and timestamps never reach the page', () => {
    expect(publicPlan(null)).toBeNull();
    expect(publicPlan({ found: 3, mode: 'call', flagged: true, flaggedAt: 'x', sentAt: 'y', ai: { en3: GOOD } }))
      .toEqual({ found: 3, mode: 'call', flagged: true, addedToVisit: false, sent: true });
  });
});

describe('parseSuggestion', () => {
  it('the full shape, fenced or not, trimmed', () => {
    expect(parseSuggestion(JSON.stringify(GOOD))).toEqual(GOOD);
    expect(parseSuggestion('```json\n' + JSON.stringify({ ...GOOD, agree: '  a  ' }) + '\n```')).toEqual(GOOD);
  });

  it.each([
    ['not JSON', 'sorry'],
    ['no message', JSON.stringify({ ...GOOD, msg: '' })],
    ['two questions', JSON.stringify({ ...GOOD, qs: ['q1', 'q2'] })],
    ['a non-string step', JSON.stringify({ ...GOOD, visit: ['v1', 2, 'v3'] })],
    ['no check', JSON.stringify({ ...GOOD, check: undefined })],
    ['a message too long for WhatsApp', JSON.stringify({ ...GOOD, msg: 'x'.repeat(1001) })],
  ])('%s: null', (_why, raw) => {
    expect(parseSuggestion(raw)).toBeNull();
  });
});

describe('suggestionFor', () => {
  const CARD = {
    teacher: 'Sadia Bibi', school: 'IMSG I-9/4', nth: 2, language: 'en', reasons: ['missed'],
    pattern: { missed: { step: 'Collaborative Structures', n: 4, of: 5 }, level: 'steady' },
    evidence: [{ code: 'missed', moves: [{ text: 'Pair talk', evidence: 'No pair talk heard.' }] }],
  };

  it('asks the model once, caches the answer under her answer and language, and the model never sees her name or school', async () => {
    const row = ROW({ coach_plan: { found: 1, mode: 'call' } });
    const prompts = [];
    const complete = async (p) => { prompts.push(p); return JSON.stringify(GOOD); };
    const sb = fakeSupabase([row]);
    expect(await suggestionFor(sb, 'me', 'r1', 1, { card: async () => CARD, complete })).toEqual(GOOD);
    expect(row.coach_plan).toMatchObject({ found: 1, mode: 'call', ai: { en1: GOOD } });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('Collaborative Structures');
    expect(prompts[0]).toContain('{name}');
    expect(prompts[0]).not.toContain('Sadia');
    expect(prompts[0]).not.toContain('I-9/4');

    expect(await suggestionFor(sb, 'me', 'r1', 1, { card: async () => CARD, complete })).toEqual(GOOD);
    expect(prompts).toHaveLength(1);
  });

  it('a coach reading Urdu gets her own cache entry', async () => {
    const row = ROW({ coach_plan: { ai: { en1: GOOD } } });
    const prompts = [];
    const ur = { ...GOOD, agree: 'اردو' };
    await suggestionFor(fakeSupabase([row]), 'me', 'r1', 1, {
      card: async () => ({ ...CARD, language: 'ur' }), complete: async (p) => { prompts.push(p); return JSON.stringify(ur); },
    });
    expect(prompts[0]).toContain('Urdu');
    expect(row.coach_plan.ai).toEqual({ en1: GOOD, ur1: ur });
  });

  it('a model that fails or answers badly: null, nothing cached, so the template stays', async () => {
    const row = ROW();
    const sb = fakeSupabase([row]);
    expect(await suggestionFor(sb, 'me', 'r1', 2, { card: async () => CARD, complete: async () => { throw new Error('429'); } })).toBeNull();
    expect(await suggestionFor(sb, 'me', 'r1', 2, { card: async () => CARD, complete: async () => 'nope' })).toBeNull();
    expect(sb.writes).toEqual([]);
  });

  it("another coach's request: undefined (the route's 404), no model call", async () => {
    let called = 0;
    const out = await suggestionFor(fakeSupabase([ROW({ coach_user_id: 'someone' })]), 'me', 'r1', 1, {
      card: async () => CARD, complete: async () => { called += 1; return JSON.stringify(GOOD); },
    });
    expect(out).toBeUndefined();
    expect(called).toBe(0);
  });
});
