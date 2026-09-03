/**
 * The hero report's uptake block — "Last time we asked … / Done · Getting there ·
 * Not this time" — above the green box, from the loop state. Never a score.
 * RED FIRST.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadTrendData: jest.fn(async () => []), loadPriorAction: jest.fn(async () => null) }));
jest.mock('../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn(), extractKeyFromUrl: jest.fn() }));
const mockHtml = { last: '' };
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn(async (html) => { mockHtml.last = html; return Buffer.from('png'); }) }));
const mockNarrative = jest.fn(async () => ({ affirmation: 'x', moments: [], horizon_title: 'h' }));
jest.mock('../../bot/shared/services/coaching/report-v2/narrative.service', () => ({ generateReportNarrative: (...a) => mockNarrative(...a), fixCodeswitch: (s) => s }));

const { buildHeroReportHtml } = require('../../bot/shared/services/coaching/report-v2/hero-report.template');
const { generateHeroReport, buildUptakeVm } = require('../../bot/shared/services/coaching/report-v2/hero-report.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

const ok = (id, name, score) => ({ id, name, score, applicable: true });
const analysis = { framework: 'fico', domains: { high_leverage_practices: { domain_score: 3, domain_max: 8, indicators: [ok('C1', 'Quality Questioning', 2), ok('C3', 'Effective Feedback', 1)] } }, scores: { overall_marks: 3, overall_max_marks: 8, overall_percentage: 37.5 }, focus_area: { domain: 'high_leverage_practices', indicator: 'C3', try_this_tomorrow: 'x' } };
const PRIOR = { target: { indicator: 'C3', domain: 'high_leverage_practices', name: 'Effective Feedback' }, action: 'After every wrong answer, say one sentence that names the next step.', action_spec: { count_target: { specific_feedback_moves: 3, next_step_feedback: 1 } }, attempt: 1, angle: 'tell', session_id: 'p1' };
const loopWith = (status, state = {}) => ({ prior: PRIOR, status, state: { target: PRIOR.target, attempt: 2, angle: 'cue', achieved_streak: 0, target_status: 'open', ...state } });
const uptake = { count: { specific_feedback_moves: 2, next_step_feedback: 0 }, evidence: 'q', moment: 'minute 12' };
const vm = (lang, extra) => ({ language: lang, brand: 'niete', teacherName: 'Sana', topic: 't', date: '2026-09-03', score: { overall: 37, marks: 3, max: 8 }, groups: [], narrative: { affirmation: 'x', moments: [] }, trend: [], tryNext: 'Next class, try…', ...extra });

describe('template — the block', () => {
  test('renders above the green box with the ask, the status pill and the line; no percentage inside', () => {
    const html = buildHeroReportHtml(vm('en', { uptake: { asked: PRIOR.action, status: 'partial', line: 'Getting there — specific feedback moves 2, next step feedback 0.' } }));
    const i = html.indexOf('class="uptake"');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(html.indexOf('class="try"'));
    expect(html).toContain('Last time we asked');
    expect(html).toContain(PRIOR.action);
    expect(html).toContain('Getting there');
    const block = html.slice(i, html.indexOf('class="try"'));
    expect(/\d+%/.test(block)).toBe(false);
  });
  test('absent without vm.uptake; the chrome label stays English on an Urdu report while the line stays Urdu', () => {
    expect(buildHeroReportHtml(vm('en', {}))).not.toContain('class="uptake"');
    const html = buildHeroReportHtml(vm('ur', { uptake: { asked: 'ہر غلط جواب کے بعد اگلا قدم بتائیں', status: 'achieved', line: 'ہو گیا — specific feedback moves 3' } }));
    expect(html).toContain('Last time we asked');
    expect(html).toContain('ہر غلط جواب');
    expect(html).toContain('ہو گیا');
  });
});

describe('service — buildUptakeVm', () => {
  test('achieved / partial / not_seen: the ask, the status, a line with the tally in words', () => {
    for (const s of ['achieved', 'partial', 'not_seen']) {
      const u = buildUptakeVm(loopWith(s), uptake, 'en');
      expect(u.asked).toBe(PRIOR.action);
      expect(u.status).toBe(s);
      expect(u.line).toMatch(/specific feedback moves/);
      expect(/\d+%/.test(u.line)).toBe(false);
    }
  });
  test('not_applicable names the target that returns; unknown says we could not count; hand_over adds the coach line', () => {
    expect(buildUptakeVm(loopWith('not_applicable', { bridge: true }), null, 'en').line).toMatch(/Effective Feedback/);
    expect(buildUptakeVm(loopWith('unknown'), null, 'en').line).toMatch(/count/i);
    expect(buildUptakeVm(loopWith('not_seen', { attempt: 5, angle: 'hand_over', hand_over: true }), uptake, 'en').line).toMatch(/coach/i);
  });
  test('Urdu lines are Urdu; no loop, no prior, or no_prior → null', () => {
    expect(/[؀-ۿ]/.test(buildUptakeVm(loopWith('partial'), uptake, 'ur').line)).toBe(true);
    expect(buildUptakeVm(null, uptake, 'en')).toBeNull();
    expect(buildUptakeVm({ prior: null, status: 'no_prior', state: {} }, uptake, 'en')).toBeNull();
  });
  test('the catalog carries every line in both languages', () => {
    for (const k of ['uptakeLineAchieved', 'uptakeLinePartial', 'uptakeLineNotSeen', 'uptakeLineNotApplicable', 'uptakeLineUnknown', 'uptakeLineHandOver']) {
      const en = resolveUx(k, { language: 'en', params: { count: 'c', target: 't' } });
      const ur = resolveUx(k, { language: 'ur', params: { count: 'c', target: 't' } });
      expect(en.trim().length).toBeGreaterThan(0);
      expect(/[؀-ۿ]/.test(ur)).toBe(true);
    }
  });
});

describe('service — generateHeroReport with a loop', () => {
  test('the narrative gets the LOOP target and the rendered HTML carries the block', async () => {
    mockHtml.last = '';
    await generateHeroReport({ id: 's2', user_id: 'u1', transcript_text: 't', created_at: '2026-09-03' }, { ...analysis, uptake }, { teacherName: 'Sana', language: 'en', brand: 'niete', commitmentAction: 'Next class…', target: PRIOR.target, loop: loopWith('partial') });
    expect(mockNarrative.mock.calls[0][1].target.indicator).toBe('C3');
    expect(mockHtml.last).toContain('class="uptake"');
    expect(mockHtml.last).toContain('Getting there');
  });
  test('without a loop the HTML has no block', async () => {
    mockHtml.last = '';
    await generateHeroReport({ id: 's3', user_id: 'u1', transcript_text: 't', created_at: '2026-09-03' }, analysis, { teacherName: 'Sana', language: 'en', brand: 'niete', commitmentAction: 'x' });
    expect(mockHtml.last).not.toContain('class="uptake"');
  });
});
