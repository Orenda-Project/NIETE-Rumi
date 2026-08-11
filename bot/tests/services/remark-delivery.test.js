/**
 * bd-2531 — submit + narrative delivery, and what happens when the LLM fails.
 *
 * Design spec §6/§10, verbatim: "if generation fails, the remark + scores still
 * save; the narrative is queued/retried and the principal is told 'saved —
 * feedback sending.' A submission is never lost to an LLM error."
 *
 * So the ORDER is the contract:
 *   1. scores + submitted_at persist          ← durable, must never be lost
 *   2. narrative generated                    ← may fail
 *   3. narrative delivered to the teacher     ← may fail
 * A failure at 2 or 3 must leave 1 intact and the remark RETRIABLE.
 *
 * No new jobs table: `coaching_jobs` exists in the schema but nothing processes
 * it (verified — zero non-DDL references), and the LIVE pattern in this repo is
 * stale-session.worker.js sweeping a table BY STATUS. supervisor_remarks already
 * carries narrative_generated_at / narrative_sent_at, so the sweep needs no new
 * storage: "submitted but not yet generated" IS the queue.
 */
const {
  submitRemark,
  findPendingNarratives,
  PENDING_REASON,
} = require('../../shared/services/remark/remark-delivery.service');

const SCORES = [1, 2, 3, 4, 5].map((ordinal) => ({ ordinal, score: 3 }));
const REMARK = { id: 'r-1', teacher_id: 't-1', principal_user_id: 'p-1', cycle_id: 'c-1' };
const TEACHER = { id: 't-1', phone_number: '923001234567', preferred_language: 'ur' };

function makeDeps(overrides = {}) {
  const calls = { persisted: [], generated: [], sentTeacher: [], sentPrincipal: [], marked: [] };
  return {
    calls,
    deps: {
      persistSubmission: async (r) => { calls.persisted.push(r); return { ...REMARK, submitted_at: 'now' }; },
      loadScores: async () => SCORES,
      loadTeacher: async () => TEACHER,
      generateNarrative: async (i) => { calls.generated.push(i); return { opening: 'o', strengths: 's', growth: 'g', action_plan: 'a' }; },
      sendToTeacher: async (m) => { calls.sentTeacher.push(m); },
      sendToPrincipal: async (m) => { calls.sentPrincipal.push(m); },
      markNarrative: async (id, patch) => { calls.marked.push([id, patch]); },
      ...overrides,
    },
  };
}

describe('bd-2531 — the happy path', () => {
  test('persists FIRST, then generates, then delivers', async () => {
    const order = [];
    const { deps } = makeDeps({
      persistSubmission: async (r) => { order.push('persist'); return { ...REMARK, submitted_at: 'now' }; },
      generateNarrative: async () => { order.push('generate'); return { opening: 'o', strengths: 's', growth: 'g', action_plan: 'a' }; },
      sendToTeacher: async () => { order.push('send'); },
    });
    await submitRemark({ remark: REMARK }, deps);
    expect(order).toEqual(['persist', 'generate', 'send']);
  });

  test('the teacher is messaged in HER language, not the form language', async () => {
    // Spec §2: "in the teacher's language (fallback to form language)". The
    // principal may fill the form in English while the teacher reads Urdu.
    const { calls, deps } = makeDeps();
    await submitRemark({ remark: REMARK, formLanguage: 'en' }, deps);
    expect(calls.generated[0].language).toBe('ur');
  });

  test('falls back to the form language when the teacher has no preference', async () => {
    const { calls, deps } = makeDeps({ loadTeacher: async () => ({ id: 't-1', phone_number: '92300' }) });
    await submitRemark({ remark: REMARK, formLanguage: 'en' }, deps);
    expect(calls.generated[0].language).toBe('en');
  });

  test('the principal copy carries scores; the teacher message does NOT', async () => {
    const { calls, deps } = makeDeps();
    await submitRemark({ remark: REMARK }, deps);
    const principal = JSON.stringify(calls.sentPrincipal[0]);
    expect(principal).toMatch(/s_pct|s_score|scores/);
    const teacher = JSON.stringify(calls.sentTeacher[0]);
    expect(teacher).not.toMatch(/s_pct|s_score/);
    expect(teacher).not.toMatch(/\b(?:15|75)\b/);   // the S / S_pct for all-3s
  });

  test('both narrative timestamps are stamped on success', async () => {
    const { calls, deps } = makeDeps();
    await submitRemark({ remark: REMARK }, deps);
    const patch = Object.assign({}, ...calls.marked.map(([, p]) => p));
    expect(patch.narrative_generated_at).toBeTruthy();
    expect(patch.narrative_sent_at).toBeTruthy();
  });
});

describe('bd-2531 — an LLM failure NEVER loses the submission', () => {
  test('scores stay persisted when generation throws', async () => {
    const { calls, deps } = makeDeps({
      generateNarrative: async () => { throw new Error('upstream 503'); },
    });
    const res = await submitRemark({ remark: REMARK }, deps);
    expect(calls.persisted).toHaveLength(1);          // the durable part survived
    expect(res.saved).toBe(true);
    expect(res.narrativePending).toBe(true);
  });

  test('submitRemark does NOT throw on a generation failure', async () => {
    // The principal must see "saved — feedback sending", not an error. If this
    // throws, the route 500s and she believes her work was lost.
    const { deps } = makeDeps({ generateNarrative: async () => { throw new Error('503'); } });
    await expect(submitRemark({ remark: REMARK }, deps)).resolves.toBeTruthy();
  });

  test('the principal is told "saved, feedback sending" — not "done"', async () => {
    const { calls, deps } = makeDeps({ generateNarrative: async () => { throw new Error('503'); } });
    await submitRemark({ remark: REMARK }, deps);
    expect(calls.sentPrincipal).toHaveLength(1);
    expect(calls.sentPrincipal[0].narrativePending).toBe(true);
  });

  test('the teacher is NOT messaged when generation failed', async () => {
    // Half a narrative is worse than none — she must not receive an empty or
    // partial evaluation message.
    const { calls, deps } = makeDeps({ generateNarrative: async () => { throw new Error('503'); } });
    await submitRemark({ remark: REMARK }, deps);
    expect(calls.sentTeacher).toHaveLength(0);
  });

  test('a leaked-score rejection is treated as a failure, not a delivery', async () => {
    // scrubScores throws — that must queue a retry, never send the raw text.
    const { calls, deps } = makeDeps({
      generateNarrative: async () => { throw new Error('refused — a score leaked into "growth"'); },
    });
    const res = await submitRemark({ remark: REMARK }, deps);
    expect(calls.sentTeacher).toHaveLength(0);
    expect(res.narrativePending).toBe(true);
  });

  test('a DELIVERY failure still records the narrative as generated', async () => {
    // Spec §10: "teacher unreachable → feedback stored + web-viewable; delivery
    // marked pending". Regenerating would waste an LLM call and could produce
    // different words for the same evaluation.
    const { calls, deps } = makeDeps({
      sendToTeacher: async () => { throw new Error('WhatsApp 470 outside window'); },
    });
    const res = await submitRemark({ remark: REMARK }, deps);
    const patch = Object.assign({}, ...calls.marked.map(([, p]) => p));
    expect(patch.narrative_text).toBeTruthy();
    expect(patch.narrative_generated_at).toBeTruthy();
    expect(patch.narrative_sent_at).toBeFalsy();
    expect(res.deliveryPending).toBe(true);
  });
});

describe('bd-2531 — the sweep: submitted-but-undelivered IS the queue', () => {
  test('a remark awaiting generation is found', () => {
    const rows = [{ id: 'r-1', submitted_at: 't', narrative_generated_at: null, narrative_sent_at: null }];
    expect(findPendingNarratives(rows)).toEqual([
      { id: 'r-1', reason: PENDING_REASON.GENERATE },
    ]);
  });

  test('a generated-but-unsent remark is found as a DELIVERY retry', () => {
    const rows = [{ id: 'r-2', submitted_at: 't', narrative_text: 'x', narrative_generated_at: 't', narrative_sent_at: null }];
    expect(findPendingNarratives(rows)).toEqual([
      { id: 'r-2', reason: PENDING_REASON.DELIVER },
    ]);
  });

  test('a fully delivered remark is NOT re-processed', () => {
    const rows = [{ id: 'r-3', submitted_at: 't', narrative_generated_at: 't', narrative_sent_at: 't' }];
    expect(findPendingNarratives(rows)).toEqual([]);
  });

  test('an UNSUBMITTED remark is never swept — a partial is not a queue entry', () => {
    // The single most important exclusion: a principal mid-rubric must not have
    // a narrative generated and fired at her teacher.
    const rows = [{ id: 'r-4', submitted_at: null, narrative_generated_at: null, narrative_sent_at: null }];
    expect(findPendingNarratives(rows)).toEqual([]);
  });
});
