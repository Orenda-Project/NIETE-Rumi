/**
 * The coach's Support Brief opens with the open target: what the AI coach asked,
 * how many times, what happened last lesson — instead of "Developing →
 * Developing → Developing". Runtime data on the existing Flow screens; no
 * Flow republish. RED FIRST.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { buildBriefViewModel, BRIEF_STRINGS } = require('../../bot/shared/services/observe/observe-brief-card');
const LOOP = { target_name: 'Effective Feedback', asked: 'After every wrong answer, say one sentence that names the next step.', attempt: 2, angle: 'cue', last_status: 'partial', hand_over: false, instrument: 'self' };
const base = (lang, extra = {}) => ({ teacher: { teacher_name: 'Sana', school_name: 'GPS X', preferred_language: lang, grade: 3 }, trend: [{ pct: 50 }, { pct: 55 }], strength: 'warm questions', growth: 'getting every student involved', moves: [{ text: 'm1' }], ...extra });

describe('buildBriefViewModel with a loop', () => {
  test('growth_text names the target, the attempts and last lesson; trend_text ends with the ask; never a bare score', () => {
    const vm = buildBriefViewModel(base('en', { loop: LOOP }));
    expect(vm.growth_text).toContain('Effective Feedback');
    expect(vm.growth_text).toMatch(/2 times/);
    expect(vm.growth_text).toMatch(/Getting there/);
    expect(vm.trend_text.trim().endsWith(LOOP.asked)).toBe(true);
    expect(vm.trend_text).toMatch(/Last asked/);
    for (const t of [vm.growth_text, vm.trend_text]) expect(/\d+%/.test(t)).toBe(false);
  });
  test('the hand-over line replaces the last-asked prefix when the AI coach has run out of angles', () => {
    const vm = buildBriefViewModel(base('en', { loop: { ...LOOP, attempt: 5, hand_over: true } }));
    expect(vm.trend_text).toMatch(/hand-over/i);
    expect(vm.trend_text).toContain(LOOP.asked);
  });
  test('Urdu chrome, Urdu status word, the ask verbatim', () => {
    const vm = buildBriefViewModel(base('ur', { loop: LOOP }));
    expect(/[؀-ۿ]/.test(vm.growth_text)).toBe(true);
    expect(vm.growth_text).toContain('Effective Feedback');
    expect(vm.trend_text).toContain(LOOP.asked);
  });
  test('no loop → byte-identical to today', () => {
    expect(buildBriefViewModel(base('en', { loop: null }))).toEqual(buildBriefViewModel(base('en')));
  });
  test('every new string exists in all four catalog languages', () => {
    for (const k of ['asked_times', 'last_lesson', 'status_achieved', 'status_partial', 'status_not_seen', 'status_not_applicable', 'status_unknown', 'last_asked_prefix', 'hand_over_line']) {
      for (const lang of ['en', 'ur', 'sw', 'ar']) expect(typeof BRIEF_STRINGS[k][lang]).toBe('string');
    }
  });
});

describe('the handler passes the loop through', () => {
  jest.mock('../../bot/shared/services/observe/assignment/leader-source', () => ({
    buildBrief: jest.fn(async () => ({ teacher: { teacher_name: 'Sana', preferred_language: 'en' }, trend: [], strengthLabel: 's', growthLabel: 'g', moves: [], noData: false, loop: { target_name: 'Effective Feedback', asked: 'ask', attempt: 2, angle: 'cue', last_status: 'partial', hand_over: false } })),
    resolveTeacher: jest.fn(), listSchools: jest.fn(async () => []),
  }));
  jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({ getState: jest.fn(async () => null), setState: jest.fn(async () => {}) }));
  test('briefScreen renders the target line from brief.loop', async () => {
    const { briefScreen } = require('../../bot/shared/handlers/observe-visit-flow.handler');
    const res = await briefScreen('coach-1', { teacher_ext_id: 'T1', school_ext_id: 'S1' }, 'BRIEF');
    expect(res.data.growth_text).toContain('Effective Feedback');
    expect(res.data.trend_text).toContain('ask');
  });
});
