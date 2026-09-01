'use strict';
/**
 * bd-5knlj — three silent-failure classes in the fidelity engine, each measured
 * on prod (Aug 24 – Sep 1): 5 sessions lost to version drift (the moves store is
 * a frozen Aug-20 backfill; the Aug-18 02:01 regen batch's stamps miss exactly),
 * 4 to a transient analyzer failure with no retry, and uploads with a
 * 1,052,368-char lesson_plan_text that no guard capped.
 */
const { computeLpFidelity, UPLOAD_TEXT_CAP, fidelityPatch } = require('../../../bot/shared/services/coaching/fidelity/fidelity-orchestrator');

const OK_ANALYSIS = async () => ({ moves: [{ text: 'm', verdict: 'done', counted: true }] });
const OK_SCORE = () => ({ fidelity_pct: 80, band: 'green', prescribed_count: 1, moves: [{ text: 'm', verdict: 'done', counted: true }] });

describe('version drift → fallbackToCurrent', () => {
  it('resolves the CURRENT move-list when the exact version is gone, and flags the drift', async () => {
    const calls = [];
    const res = await computeLpFidelity(
      { corpusKey: { lesson_id: 'g3_ch5_seg995', version_stamp: 'v8-20260818T0201' }, transcript: 't' },
      {
        resolveMoveList: async (key, opts) => {
          calls.push(opts);
          // the store misses the exact version; only the fallback path finds a row
          return opts && opts.fallbackToCurrent
            ? { lesson_id: key.lesson_id, moves: [{ text: 'm' }], resolved: 'current', template: 'T' }
            : null;
        },
        analyzeFidelity: OK_ANALYSIS,
        scoreFidelity: OK_SCORE,
      },
    );
    expect(calls[0] && calls[0].fallbackToCurrent).toBe(true);
    expect(res.status).toBe('ok');
    expect(res.meta && res.meta.version_drift).toBe(true);
  });
});

describe('transient analyzer failure → one retry', () => {
  it('a single throw is retried and succeeds', async () => {
    let attempts = 0;
    const res = await computeLpFidelity(
      { uploadedText: 'a plan', transcript: 't' },
      {
        extractUploadedLp: async () => ({ moves: [{ text: 'm' }] }),
        analyzeFidelity: async () => { attempts += 1; if (attempts === 1) throw new Error('flake'); return { moves: [{ text: 'm', verdict: 'done', counted: true }] }; },
        scoreFidelity: OK_SCORE,
      },
    );
    expect(attempts).toBe(2);
    expect(res.status).toBe('ok');
  });
});

describe('uploaded text cap', () => {
  it('a megabyte of text is capped before extraction, at a sane bound', async () => {
    let seen = null;
    await computeLpFidelity(
      { uploadedText: 'word '.repeat(300000), transcript: 't' },
      {
        extractUploadedLp: async (text) => { seen = text; return { moves: [] }; },
        analyzeFidelity: OK_ANALYSIS,
        scoreFidelity: OK_SCORE,
      },
    );
    expect(seen.length).toBeLessThanOrEqual(UPLOAD_TEXT_CAP);
    expect(UPLOAD_TEXT_CAP).toBeGreaterThanOrEqual(10000);
  });
});

describe('fidelityPatch — non-ok statuses are persisted, not discarded', () => {
  it('ok, lp_absent and fidelity_unavailable all persist; only null is empty', () => {
    expect(fidelityPatch(null)).toEqual({});
    expect(fidelityPatch({ status: 'ok', fidelity_pct: 70 })).toEqual({ lp_fidelity: { status: 'ok', fidelity_pct: 70 } });
    expect(fidelityPatch({ status: 'lp_absent' })).toEqual({ lp_fidelity: { status: 'lp_absent' } });
    expect(fidelityPatch({ status: 'fidelity_unavailable', error: 'x' })).toEqual({ lp_fidelity: { status: 'fidelity_unavailable', error: 'x' } });
  });
});
