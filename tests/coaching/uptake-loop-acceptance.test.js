/**
 * Feedback-uptake loop — the acceptance harness (deterministic part).
 *
 * Runs the six checks the design promised over the REAL FICO v4 sessions in
 * tests/fixtures (staging, sanitised) plus simulated loop runs. Everything
 * here is model-free: the LLM-shaped checks (does the card's wording actually
 * change?) are the staging field test's job. Skipped in CI; run by hand with
 *   UPTAKE_ACCEPTANCE=1 node tests/run.js --testPathPattern=uptake-loop-acceptance --forceExit
 */
const fs = require('fs');
const path = require('path');

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({ openai: { chat: { completions: { create: jest.fn() } } } }));

const run = process.env.UPTAKE_ACCEPTANCE === '1' ? describe : describe.skip;

const loop = require('../../bot/shared/services/coaching/uptake-loop.service');
const { resolveTarget } = require('../../bot/shared/services/coaching/target-resolver');
const { cardTarget, buildPrompt } = require('../../bot/shared/services/coaching/coaching-card/commitment-card.service');
const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const { BRIEF_STRINGS } = require('../../bot/shared/services/observe/observe-brief-card');
const { COACHING_CARD_COPY } = require('../../bot/shared/config/coaching-card.config');
const { buildUptakeVm } = require('../../bot/shared/services/coaching/report-v2/hero-report.service');

function loadSessions() {
  const p = path.join(__dirname, '..', 'fixtures', 'fico-v4-staging-sessions.json');
  const fx = JSON.parse(fs.readFileSync(p, 'utf8')).sessions;
  return fx.map((s) => {
    const a = { framework: 'fico', domains: {}, focus_area: s.focus_area ? { ...s.focus_area, try_this_tomorrow: 'the scorer\'s move for this lesson' } : undefined };
    for (const [k, inds] of Object.entries(s.domains)) a.domains[k] = { indicators: inds.map((i) => ({ ...i, name: i.id })) };
    return { id: s.session, teacher: s.teacher, analysis: fico.computeScores(a) };
  });
}
const applicable = (a, id) => loop.applicableToday(a, id);
const rowOf = (a, id) => Object.values(a.domains).flatMap((d) => d.indicators).find((i) => i.id === id);

run('feedback-uptake loop — acceptance', () => {
  const sessions = loadSessions();
  const byTeacher = {};
  for (const s of sessions) (byTeacher[s.teacher] = byTeacher[s.teacher] || []).push(s);
  const pairs = Object.values(byTeacher).filter((l) => l.length >= 2).flatMap((l) => l.slice(1).map((s, i) => [l[i], s]));

  test('the fixture is real and non-trivial', () => {
    expect(sessions.length).toBeGreaterThan(10);
    // eslint-disable-next-line no-console
    console.log(`[acceptance] ${sessions.length} sessions, ${Object.keys(byTeacher).length} teachers, ${pairs.length} consecutive pairs`);
  });

  test('1 · coherence — with the loop on, the card and the hero name the same indicator on every session', () => {
    for (const s of sessions) {
      const state = loop.nextTarget(null, 'no_prior', s.analysis);
      const l = { prior: null, status: 'no_prior', state };
      const heroTarget = (state.target && state.target.indicator) || (resolveTarget(s.analysis) || {}).indicator || null;
      const card = cardTarget(s.analysis, l);
      if (state.target) expect(card && card.indicator).toBe(heroTarget);
    }
  });

  test('1b · coherence across a pair — the uptake block names the prior target; the card the sticky target when applicable', () => {
    let checked = 0;
    for (const [a, b] of [...pairs, ...sessions.slice(1).map((s, i) => [sessions[i], s])]) {
      const first = loop.nextTarget(null, 'no_prior', a.analysis);
      if (!first.target) continue;
      const prior = { ...loop.buildRecord(first, { prior: null, analysis: a.analysis, card: { action: 'ask' } }), session_id: a.id, created_at: '2026-09-01T00:00:00Z' };
      const status = loop.deriveUptakeStatus({ count: {} }, prior, b.analysis);
      const state = loop.nextTarget(prior, status, b.analysis);
      const vm = buildUptakeVm({ prior, status, state }, b.analysis.uptake, 'en');
      expect(vm.asked).toBe('ask');
      if (status !== 'not_applicable' && state.target && !state.closed) {
        expect(state.target.indicator).toBe(prior.target.indicator);
        const card = cardTarget(b.analysis, { prior, status, state });
        expect(card && card.indicator).toBe(prior.target.indicator);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  test('2 · applicability — no chosen target, card target or prompt target is flagged not applicable; never Section B; never the top rung', () => {
    const counts = {};
    for (const s of sessions) {
      const t = loop.chooseTarget(s.analysis, null);
      if (!t) continue;
      counts[t.indicator] = (counts[t.indicator] || 0) + 1;
      expect(applicable(s.analysis, t.indicator)).toBe(true);
      expect(t.indicator[0]).not.toBe('B');
      expect(rowOf(s.analysis, t.indicator).score).toBeLessThan(fico.getScoringConstants().scaleMax);
      const c = cardTarget(s.analysis, { prior: null, status: 'no_prior', state: loop.nextTarget(null, 'no_prior', s.analysis) });
      expect(applicable(s.analysis, c.indicator)).toBe(true);
      const p = buildPrompt('en', s.analysis, { question: 'q', answer: 'a real reflective answer' }, null, { prior: null, status: 'no_prior', state: loop.nextTarget(null, 'no_prior', s.analysis) });
      const named = (p.match(/THE TARGET[^\n]*indicator ([A-F]\d+)/) || [])[1];
      expect(named).toBe(t.indicator);
    }
    const total = Object.values(counts).reduce((x, y) => x + y, 0);
    const top = Object.entries(counts).sort((x, y) => y[1] - x[1])[0];
    // eslint-disable-next-line no-console
    console.log(`[acceptance] target distribution over ${total} sessions:`, counts, `— top share ${top ? (100 * top[1] / total).toFixed(0) : 0}% (${top && top[0]}); the switch-on gate wants ≤ 25% on the re-scored corpus`);
  });

  test('3 · the recorded verdict IS the computed verdict, for every tally shape', () => {
    for (const s of sessions) {
      const first = loop.nextTarget(null, 'no_prior', s.analysis);
      if (!first.target) continue;
      const prior = { ...loop.buildRecord(first, { prior: null, analysis: s.analysis, card: { action: 'ask' } }), session_id: s.id, created_at: '2026-09-01T00:00:00Z' };
      const bar = prior.action_spec.count_target;
      const keys = Object.keys(bar);
      const shapes = [null, { count: 'junk' }, { count: {} }];
      for (const k of keys) {
        shapes.push({ count: Object.fromEntries(keys.map((kk) => [kk, kk === k ? bar[kk] : 0])) });
        shapes.push({ count: Object.fromEntries(keys.map((kk) => [kk, bar[kk] + 1])) });
        shapes.push({ count: Object.fromEntries(keys.map((kk) => [kk, 0])) });
      }
      for (const u of shapes) {
        const status = loop.deriveUptakeStatus(u, prior, s.analysis);
        const state = loop.nextTarget(prior, status, s.analysis);
        const rec = loop.buildRecord(state, { prior, analysis: s.analysis, card: { action: 'next' }, uptake: u, uptakeStatus: status });
        expect(rec.uptake.status).toBe(status);
        expect(['achieved', 'partial', 'not_seen', 'not_applicable', 'unknown']).toContain(status);
      }
    }
  });

  test('4 · never the same twice — the angle differs on every consecutive attempt and the five shapes do not overlap', () => {
    const { LADDER } = loop;
    for (let i = 1; i < LADDER.length; i += 1) expect(LADDER[i]).not.toBe(LADDER[i - 1]);
    const s = sessions.find((x) => loop.chooseTarget(x.analysis, null));
    let prior = { ...loop.buildRecord(loop.nextTarget(null, 'no_prior', s.analysis), { prior: null, analysis: s.analysis, card: { action: 'ask' } }), session_id: 'p0', created_at: '2026-09-01T00:00:00Z' };
    const angles = [prior.angle];
    for (let n = 0; n < 5; n += 1) {
      const state = loop.nextTarget(prior, 'not_seen', s.analysis);
      angles.push(state.angle);
      prior = { ...loop.buildRecord(state, { prior, analysis: s.analysis, card: { action: `ask ${n}` }, uptakeStatus: 'not_seen' }), session_id: `p${n + 1}`, created_at: '2026-09-01T00:00:00Z' };
    }
    expect(angles.slice(0, 5)).toEqual(['tell', 'cue', 'show', 'shrink', 'hand_over']);
    // the five prompt shapes read differently from one another
    const a0 = s.analysis;
    const prompts = LADDER.map((angle, i) => buildPrompt('en', a0, { question: 'q', answer: 'a real reflective answer' }, null, { prior: { target: loop.chooseTarget(a0, null), action: 'ask', action_spec: {} }, status: 'not_seen', state: { target: loop.chooseTarget(a0, null), attempt: i + 1, angle, target_status: 'open' } }));
    for (let i = 1; i < prompts.length; i += 1) expect(prompts[i]).not.toBe(prompts[i - 1]);
    const shapeOf = (p) => (p.match(/ANGLE "[a-z_]+": ([^\n]+)/) || [])[1] || '';
    for (let i = 0; i < prompts.length; i += 1) for (let j = i + 1; j < prompts.length; j += 1) {
      if (LADDER[i] === 'shrink' && LADDER[j] === 'hand_over') continue; // hand_over is shrink + the coach line by design
      expect(loop.tooSimilar(shapeOf(prompts[i]), shapeOf(prompts[j]))).toBe(false);
    }
  });

  test('5 · never in the total — totals byte-identical with and without the PRIOR ACTION block and the tally', () => {
    for (const s of sessions) {
      const withTally = fico.computeScores(JSON.parse(JSON.stringify({ ...s.analysis, uptake: { count: { anything: 9 } } })));
      const without = fico.computeScores(JSON.parse(JSON.stringify(s.analysis)));
      expect(JSON.stringify(withTally.scores)).toBe(JSON.stringify(without.scores));
      const prior = { target: { indicator: 'C3', name: 'x' }, action: 'ask', action_spec: { count_target: loop.countBarFor('C3') }, baseline: { rung: 1, count: {} }, created_at: '2026-09-01' };
      const pWith = fico.buildAnalysisPrompt('T', { language: 'en', priorAction: prior });
      const pWithout = fico.buildAnalysisPrompt('T', { language: 'en' });
      expect(pWith.replace(fico.buildPriorActionBlock(prior), '').replace(/,\n\s+"uptake": \{[^\n]*\}/, '')).toBe(pWithout);
    }
  });

  test('6 · language — every fixed label resolves in en and ur; brief strings in four languages; buttons within 20 code points', () => {
    for (const k of ['uptakeLineAchieved', 'uptakeLinePartial', 'uptakeLineNotSeen', 'uptakeLineNotApplicable', 'uptakeLineUnknown', 'uptakeLineHandOver', 'coachingCardAckYes', 'coachingCardAckLater', 'coachingCardAckNo']) {
      for (const lang of ['en', 'ur']) expect(resolveUx(k, { language: lang, params: { count: 'c', target: 't' } }).trim().length).toBeGreaterThan(0);
      expect(/[؀-ۿ]/.test(resolveUx(k, { language: 'ur', params: { count: 'c', target: 't' } }))).toBe(true);
    }
    for (const k of ['asked_times', 'last_lesson', 'status_achieved', 'status_partial', 'status_not_seen', 'status_not_applicable', 'status_unknown', 'last_asked_prefix', 'hand_over_line']) {
      for (const lang of ['en', 'ur', 'sw', 'ar']) expect(BRIEF_STRINGS[k][lang].trim().length).toBeGreaterThan(0);
    }
    for (const lang of ['en', 'ur']) for (const b of Object.values(COACHING_CARD_COPY[lang].commitButtons)) expect([...b].length).toBeLessThanOrEqual(20);
  });
});
