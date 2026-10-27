'use strict';
/** NIGHTLY_JOB §6 (the five gloss gates), §4 stage 9 (re-check), §12 test 13; RUBRIC B1 (the prompt input never carries
 * evidence, a stamped quote or a name field). fetch is mocked; fixtures are fictional. */
const G = require('../../lib/insights/gloss');
const M = require('../../lib/insights/model');
const F = require('./fixtures/analysis');
const X = require('./fixtures/model');
const { readAllowed } = require('../../lib/insights/allowlist');

const SID = '00000000-0000-4000-8000-000000000002';
const cp = (s) => [...s].length;

describe('buildGlossInput (B1)', () => {
  const lpData = F.lp([F.move('m7', 'independent', 'not_done', { at: '12:30' })]);
  const allowed = readAllowed({ lp_fidelity: lpData });

  test('the exact keys the prompt reads, and nothing else', () => {
    const input = G.buildGlossInput({ wId: 'W-IP', phase: 'independent', glossMove: allowed.gloss.moves.m7, verdict: 'not_done', narrative: allowed.gloss.narrative });
    expect(Object.keys(input).sort()).toEqual(['W', 'evidence_translation', 'narrative', 'phase', 'plan_move', 'rationale', 'verdict']);
    expect(input).toMatchObject({ W: 'W-IP', plan_move: 'Plan step m7', verdict: 'not_done', evidence_translation: 'placeholder translation' });
  });

  test('never evidence, a quote or a name field, even when the caller hands them over; a Proxy proves they are not read', () => {
    const trapped = new Proxy({ text: 't', evidenceTranslation: 'e', rationale: 'r', evidence: '[12:30] placeholder quote', name: 'x', quote: 'q' }, {
      get(o, k) { if (['evidence', 'name', 'quote', 'teacher_name'].includes(k)) throw new Error(`forbidden read ${String(k)}`); return o[k]; },
    });
    const input = G.buildGlossInput({ wId: 'W-IP', glossMove: trapped, verdict: 'partial', narrative: 'n' });
    const s = JSON.stringify(input);
    expect(s).not.toMatch(/evidence"|placeholder quote|"name"|"quote"/);
  });

  test('a [MM:SS] stamp inside a grader string is removed so no stamped quote reaches the model', () => {
    const input = G.buildGlossInput({ wId: 'W-IP', glossMove: { text: 't', evidenceTranslation: '[12:30] "Sit down now"', rationale: 'see [01:02:03] here' }, verdict: 'partial', narrative: null });
    expect(input.evidence_translation).not.toMatch(/\[\s*\d/);
    expect(input.rationale).not.toMatch(/\[\s*\d/);
  });

  test('an optional lexicon redacts a name already in the notes', () => {
    const input = G.buildGlossInput({ wId: 'W-IP', glossMove: { text: 't', evidenceTranslation: 'Then Zarqonbek answered.', rationale: 'r' }, verdict: 'executed', narrative: 'فرضیہ نے پڑھا', lexicon: X.LEXICON });
    expect(JSON.stringify(input)).not.toMatch(/Zarqonbek|فرضیہ/);
  });
});

describe('prefix', () => {
  test('EN and UR, the minute from the moment, Urdu digits in Urdu', () => {
    expect(G.prefix(130)).toEqual({ en: 'At minute 2:', ur: '۲ویں منٹ پر:' });
    expect(G.prefix(18 * 60 + 42)).toEqual({ en: 'At minute 18:', ur: '۱۸ویں منٹ پر:' });
  });
});

describe('the gloss gates (test 13): each blocks its own fixture', () => {
  test('a clean gloss passes every gate', () => {
    expect(G.gateGloss(X.GLOSS.clean, X.LEXICON)).toEqual({ ok: true, failed: [] });
  });
  test.each([
    ['nameEn', 'names'], ['nameUr', 'names'], ['nameLatinInUr', 'names'],
    ['pronoun', 'pronouns'], ['script', 'script'], ['lengthEn', 'length'], ['lengthUr', 'length'],
    ['verbSing', 'ur_verb_agreement'], ['verbHon', 'ur_verb_agreement'],
  ])('%s → %s', (fixture, gate) => {
    const r = G.gateGloss(X.GLOSS[fixture], X.LEXICON);
    expect(r.ok).toBe(false);
    expect(r.failed).toEqual([gate]);
  });
  test('a name inside a longer word is no hit', () => {
    expect(G.gateGloss(X.GLOSS.substringNoHit, X.LEXICON).ok).toBe(true);
  });
  test('a missing field fails the shape gate', () => {
    expect(G.gateGloss({ en: 'x' }, []).failed).toEqual(['shape']);
  });
  test('the lexicon is never echoed in a gate result', () => {
    expect(JSON.stringify(G.gateGloss(X.GLOSS.nameEn, X.LEXICON))).not.toMatch(/Zarqonbek/);
  });
});

describe('glossMoment', () => {
  const moment = { moment_s: 130, from_s: 130, to_s: 200 };
  const input = G.buildGlossInput({ wId: 'W-IP', glossMove: { text: 't', evidenceTranslation: 'e', rationale: 'r' }, verdict: 'not_done', narrative: 'n' });
  const deps = (fetch, extra = {}) => ({ fetch, apiKey: 'k', sessionId: SID, target: 'm7', jobRunId: null, ...extra });

  test('ok: prefixed text within 90 / 70 code points, status ok, one run row', async () => {
    const fetch = X.scriptedFetch([X.ok({ gloss_en: X.GLOSS.clean.en, gloss_ur: X.GLOSS.clean.ur })]);
    const out = await G.glossMoment({ moment, input, lexicon: X.LEXICON, ledger: M.createLedger({}), deps: deps(fetch) });
    expect(out.patch.gloss_status).toBe('ok');
    expect(out.patch.gloss_en).toBe(`At minute 2: ${X.GLOSS.clean.en}`);
    expect(out.patch.gloss_ur.startsWith('۲ویں منٹ پر: ')).toBe(true);
    expect(cp(out.patch.gloss_en)).toBeLessThanOrEqual(90);
    expect(cp(out.patch.gloss_ur)).toBeLessThanOrEqual(70);
    expect(out.runs).toHaveLength(1);
    expect(out.runs[0]).toMatchObject({ status: 'ok', analysis: 'gloss', prompt_version: 'gloss_v2', target: 'm7' });
    expect(fetch.calls[0].body.messages[1].content).toContain('"W":"W-IP"');
  });

  test('a gate failure → one retry → ok, still one run row with both attempts\' usage', async () => {
    const fetch = X.scriptedFetch([X.ok({ gloss_en: X.GLOSS.pronoun.en, gloss_ur: X.GLOSS.pronoun.ur }, { pin: 100, pout: 10, cost: 0.0001 }),
      X.ok({ gloss_en: X.GLOSS.clean.en, gloss_ur: X.GLOSS.clean.ur }, { pin: 100, pout: 10, cost: 0.0001 })]);
    const out = await G.glossMoment({ moment, input, lexicon: X.LEXICON, ledger: M.createLedger({}), deps: deps(fetch) });
    expect(fetch.calls).toHaveLength(2);
    expect(out.patch.gloss_status).toBe('ok');
    expect(out.runs).toHaveLength(1);
    expect(out.runs[0]).toMatchObject({ tokens_in: 200, tokens_out: 20, cost_usd: 0.0002 });
  });

  test('a gate failure twice → blocked: no text on the moment or the row, failure_class gate', async () => {
    const fetch = X.scriptedFetch([X.ok({ gloss_en: X.GLOSS.nameEn.en, gloss_ur: X.GLOSS.nameEn.ur }), X.ok({ gloss_en: X.GLOSS.nameEn.en, gloss_ur: X.GLOSS.nameEn.ur })]);
    const out = await G.glossMoment({ moment, input, lexicon: X.LEXICON, ledger: M.createLedger({}), deps: deps(fetch) });
    expect(out.patch).toMatchObject({ gloss_status: 'blocked', gloss_en: null, gloss_ur: null });
    expect(out.runs[0]).toMatchObject({ status: 'blocked', failure_class: 'gate' });
    expect(JSON.stringify(out)).not.toMatch(/Zarqonbek/);
    expect(out.runs[0].output).toEqual({ gates_failed: ['names'] });
  });

  test('a call that fails → moment failed; cap → pending; a paused gloss state → paused, no call', async () => {
    let out = await G.glossMoment({ moment, input, lexicon: [], ledger: M.createLedger({}), deps: deps(X.scriptedFetch([X.http(500), X.http(500), X.http(500), X.http(500)])) });
    expect(out.patch.gloss_status).toBe('failed');
    out = await G.glossMoment({ moment, input, lexicon: [], ledger: M.createLedger({ capUsd: 0 }), deps: deps(X.scriptedFetch([])) });
    expect(out.patch.gloss_status).toBe('pending');
    const f = X.scriptedFetch([]);
    out = await G.glossMoment({ moment, input, lexicon: [], ledger: M.createLedger({}), deps: deps(f, { glossPaused: true }) });
    expect(out.patch.gloss_status).toBe('paused');
    expect(f.calls).toHaveLength(0);
  });

  test('dry run: gated and counted, the text never returned for storage', async () => {
    const fetch = X.scriptedFetch([X.ok({ gloss_en: X.GLOSS.clean.en, gloss_ur: X.GLOSS.clean.ur })]);
    const out = await G.glossMoment({ moment, input, lexicon: X.LEXICON, ledger: M.createLedger({}), deps: deps(fetch, { dryRun: true }) });
    expect(out.dryRun).toEqual({ gated: 1, passed: 1 });
    expect(out.patch.gloss_en).toBeNull();
    expect(out.patch.gloss_ur).toBeNull();
    expect(JSON.stringify(out)).not.toContain(X.GLOSS.clean.en);
  });
});

describe('the 5% re-check and the pause', () => {
  const seq = (n) => Array.from({ length: n }, (_, i) => ({ i }));
  const rand = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();

  test('5%, at least 5, never more than there are', () => {
    expect(G.pickRecheck(seq(40), rand)).toHaveLength(5);
    expect(G.pickRecheck(seq(200), rand)).toHaveLength(10);
    expect(G.pickRecheck(seq(3), rand)).toHaveLength(3);
    const pick = G.pickRecheck(seq(200), rand);
    expect(new Set(pick.map((p) => p.i)).size).toBe(pick.length);
  });

  test('recheckVerdict reads the judge\'s output', () => {
    expect(G.recheckVerdict({ faithful: true })).toBe('faithful');
    expect(G.recheckVerdict({ faithful: false, issue: 'added' })).toBe('unfaithful');
    expect(G.recheckVerdict(null)).toBe('unreadable');
    expect(G.recheckVerdict({ faithful: 'yes' })).toBe('unreadable');
  });

  test('shouldPause: below 90% faithful over at least 50 judged', () => {
    const v = (f, u) => [...Array(f).fill('faithful'), ...Array(u).fill('unfaithful')];
    expect(G.shouldPause(v(40, 9))).toBe(false);       // 49 judged: not enough to pause
    expect(G.shouldPause(v(44, 6))).toBe(true);        // 88%
    expect(G.shouldPause(v(45, 5))).toBe(false);       // 90%
    expect(G.shouldPause([...v(45, 5), 'unreadable', 'unreadable'])).toBe(false); // unreadable is not judged
  });

  test('a re-check call: Opus, purpose recheck, a schema-valid prompt version, verdict only stored', async () => {
    const fetch = X.scriptedFetch([X.ok({ faithful: false, issue: 'placeholder' }, { cost: 0.01 })]);
    const input = G.buildGlossInput({ wId: 'W-IP', glossMove: { text: 't', evidenceTranslation: 'e', rationale: 'r' }, verdict: 'executed', narrative: 'n' });
    const out = await G.recheckGloss({ input, gloss: X.GLOSS.clean, ledger: M.createLedger({}), deps: { fetch, apiKey: 'k', sessionId: SID, target: 'm7' } });
    expect(out.verdict).toBe('unfaithful');
    expect(out.row).toMatchObject({ model: 'anthropic/claude-opus-5.5', purpose: 'recheck', analysis: 'gloss', output: { faithful: false } });
    expect(out.row.prompt_version).toMatch(/^(gloss|phonics|homework)_v[0-9]+$/);
    expect(fetch.calls[0].body.messages[0].content).toBe(M.loadPrompt('gloss_recheck_v1'));
  });
});
