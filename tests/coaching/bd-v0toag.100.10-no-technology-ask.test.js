/**
 * bd-v0toag.100.10 — Taleemabad technology use is never the one thing to try.
 *
 * G1 Urdu ch9 (Quratulain, did-it sheet row 6): the earlier report's card took the rule-based
 * fallback (_source 'fallback'), whose weakest-row pick was C10 "Integration of Taleemabad
 * Technology" at 1/4, so the teacher was told "spend 5 minutes on Integration of Taleemabad
 * Technology". C10 is not a classroom move (video-reco/target.js NO_MOVE). It may still be scored
 * and shown in the report; it is never the step the card, the horizon or the stored focus names.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const { selectNextStep } = require('../../bot/shared/services/coaching/next-step');
const { findWeakestIndicator, generatePrioritizedAction } = require('../../bot/shared/services/coaching/coaching-card/prioritized-action.service');

const ok = (id, name, score) => ({ id, name, score, applicable: true });
const TECH = ok('C10', 'Integration of Taleemabad Technology', 0);
const analysis = (focus, extra = []) => ({
  framework: 'fico',
  indicator_scheme: 'fico_main_37',
  domains: {
    lesson_plan_fidelity: { indicators: [ok('B1', 'Instructional Clarity & Learning Objectives', 2)] },
    high_leverage_practices: { indicators: [ok('C1', 'Quality Questioning', 1), TECH, ...extra] },
  },
  ...(focus ? { focus_area: { domain: 'high_leverage_practices', indicator: focus, try_this_tomorrow: 'ایک کھلا سوال پوچھیں اور تین سیکنڈ انتظار کریں' } } : {}),
});

test('the weakest-row pick skips C10 even when it scores lowest', () => {
  expect(findWeakestIndicator(analysis(null)).id).toBe('C1');
});

test('no focus_area: the fallback step is the next weakest row, not C10', () => {
  const s = selectNextStep(analysis(null));
  expect(s.target.indicator).toBe('C1');
  expect(s.fallback).toBe(true);
});

test('the scorer chose C10: it is not taken as the step', () => {
  const s = selectNextStep(analysis('C10'));
  expect(s.target.indicator).toBe('C1');
  expect(s.fallback).toBe(true);
});

test('a sticky loop target of C10 is not taken as the step', () => {
  const s = selectNextStep(analysis(null), { state: { target: { indicator: 'C10' } } });
  expect(s.target.indicator).toBe('C1');
});

test('the rule-based card asked for C10 still names another row', async () => {
  const pa = await generatePrioritizedAction(analysis(null), 'Rifat', null, 'C10');
  expect(pa.indicator).toBe('Quality Questioning (C1)');
  expect(pa.action).not.toMatch(/Technology/);
});

test('C10 the only scored row: the general card, never a technology ask', async () => {
  const only = { framework: 'fico', domains: { high_leverage_practices: { indicators: [TECH] } } };
  expect(selectNextStep(only).target).toBeNull();
  const pa = await generatePrioritizedAction(only, 'Rifat');
  expect(pa.indicator).toBe('General improvement');
});

test('C10 is still a scored row in the analysis (shown elsewhere in the report)', () => {
  const a = analysis(null);
  selectNextStep(a);
  expect(a.domains.high_leverage_practices.indicators).toContainEqual(TECH);
});
