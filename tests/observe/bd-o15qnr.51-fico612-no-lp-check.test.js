'use strict';
/**
 * bd-o15qnr.51 (queue #255) — the operator, 24 Nov ~11:15: "lesson plan moves/fideltiy step to be removed from the fico
 * 6-12." FICO 6-12 (FICO-S, coaching_sessions.framework 'fico_s_v1_2'; v1.1 forms too) only; FICO17 v6 (grades 1-5) keeps
 * everything.
 *
 * Where the lesson plan step showed in a 6-12 HITL visit: #242's lesson plan check (lp-check.js) — the debrief notes'
 * last section, the five-part judge of the coach's plan talk (the report's last block), and the week's block. Production,
 * 24 Nov: visit b4f6f109 (FICO 6-12 v1.2, debrief done) carries guide_snapshot.lp_check and feedback.lp_discussion.
 * The 6-12 Feedback Form itself (FICO-S: A-E, checklist, feedback) has no lesson plan moves step; pinned below.
 *
 * Now, for a 6-12 visit: no section in the notes, no model call for it (words or judge), and notes written before this
 * change are shown and sent without it. A 1-5 visit is exactly as before.
 */

const LP = require('../../bot/shared/services/observe/lp-check');

const move = (move_id, phase, verdict, text, extra = {}) => ({
  move_id, phase, bucket: 'must_happen', text, verdict, evidence: '', rationale: '', counted: verdict !== 'not_adjudicable', ...extra,
});

// A lesson whose plan was graded (lp_fidelity ok): the 1-5 case gets the check from this, the 6-12 case must not.
const LP_FIDELITY = {
  status: 'ok',
  moderators: { note: '', plan_navigability: '' },
  moves: [
    move('m1', 'announce', 'executed', 'Tell students what they will learn today', { evidence: '[00:40] Today we will learn…' }),
    move('m2', 'explain', 'executed', 'Explain with an example', { evidence: '[06:20] Watch me first…' }),
    move('m3', 'guided', 'not_done', 'Partner practice', { rationale: 'Students answered the teacher instead.' }),
    move('m4', 'exit', 'not_done', 'Students say what they learnt', { rationale: 'Not seen.' }),
  ],
};

const OBSERVER = 'obs-user-1';
// A FICO 6-12 visit as production stamps it: the column at start (portal-observe startFdeVisit), the record at submit.
const ficoS612 = (over = {}) => ({
  id: 'visit-612', observer_user_id: OBSERVER, framework: 'fico_s_v1_2', framework_selection_reason: 'fico_s_dc',
  analysis_data: { framework: 'fico_s_v1_2', obs612: { tool: 'ficos', rubric_id: 'fico_s_v1_2', grade: 7 }, lp_fidelity: LP_FIDELITY },
  ...over,
});
// A FICO17 v6 (grades 1-5) visit with the same graded plan.
const v6Primary = (over = {}) => ({
  id: 'visit-15', observer_user_id: OBSERVER, framework: 'fico17_v6', framework_selection_reason: 'coach_rubric_switch',
  analysis_data: { framework: 'fico17_v6', lp_fidelity: LP_FIDELITY },
  ...over,
});

const GUIDE = { intro: 'hi', conversation: ['1', '2', '3', '4', '5', '6'] };
const STORED_CHECK = () => {
  const s = LP.planState({ lp_fidelity: LP_FIDELITY });
  return LP.buildLpCheck(s, LP.fallbackWords(s, 'en'));
};

describe('which visits are FICO 6-12', () => {
  test('a FICO-S stamp anywhere on the visit: the column, the analysis, or its 6-12 record', () => {
    expect(LP.isFicoSVisit(ficoS612())).toBe(true);
    expect(LP.isFicoSVisit({ framework: 'fico_s_v1_1' })).toBe(true);
    expect(LP.isFicoSVisit({ framework: null, analysis_data: { framework: 'fico_s_v1_2' } })).toBe(true);
    expect(LP.isFicoSVisit({ analysis_data: { obs612: { tool: 'ficos' } } })).toBe(true);
  });

  test('FICO17 v6, the older FICO, FDE\'s own tools and nothing at all are not', () => {
    expect(LP.isFicoSVisit(v6Primary())).toBe(false);
    expect(LP.isFicoSVisit({ framework: 'fico', analysis_data: { framework: 'fico' } })).toBe(false);
    expect(LP.isFicoSVisit({ framework: 'obs612-enur-v1', analysis_data: { obs612: { tool: 'enur' } } })).toBe(false);
    expect(LP.isFicoSVisit(null)).toBe(false);
    expect(LP.isFicoSVisit({})).toBe(false);
  });
});

describe('the debrief notes of a 6-12 visit have no lesson plan check', () => {
  test.each(['en', 'ur'])('6-12 (%s), observer on the HITL switch, plan graded: no section, no switch read, no model call', async (lang) => {
    const switchOn = jest.fn(async () => true);
    const complete = jest.fn(async () => ({ result: {} }));
    expect(await LP.lpCheckFor(ficoS612(), lang, { switchOn, complete })).toBeNull();
    const out = await LP.attachLpCheck(GUIDE, ficoS612(), lang, { switchOn, complete });
    expect(out).toBe(GUIDE);
    expect(out).not.toHaveProperty('lp_check');
    expect(switchOn).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  test('6-12 with no plan linked: still nothing (not even the one question)', async () => {
    const visit = ficoS612({ analysis_data: { framework: 'fico_s_v1_2', obs612: { tool: 'ficos' }, lp_fidelity: { status: 'lp_absent' } } });
    expect(await LP.attachLpCheck(GUIDE, visit, 'en', { switchOn: async () => true, complete: jest.fn() })).toBe(GUIDE);
  });

  test.each(['en', 'ur'])('1-5 (%s) is unchanged: the section is added, from one words call', async (lang) => {
    const complete = jest.fn(async () => { throw new Error('no model here'); });
    const out = await LP.attachLpCheck(GUIDE, v6Primary(), lang, { switchOn: async () => true, complete });
    expect(out.conversation).toEqual(GUIDE.conversation);
    expect(out.lp_check).toMatchObject({ state: 'ok', done: 2, total: 4 });
    expect(out.lp_check.lines).toHaveLength(5);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

describe('notes written before this change: a 6-12 visit\'s are shown and sent without the section', () => {
  test('notesFor drops lp_check from a 6-12 visit\'s notes, and only that', () => {
    const stored = { ...GUIDE, lp_check: STORED_CHECK() };
    const out = LP.notesFor(ficoS612(), stored);
    expect(out).not.toHaveProperty('lp_check');
    expect(out).toEqual(GUIDE);
    expect(stored.lp_check).toBeTruthy(); // the stored notes themselves are untouched
  });

  test('1-5 notes come back as they are (the same object); no notes stay no notes', () => {
    const stored = { ...GUIDE, lp_check: STORED_CHECK() };
    expect(LP.notesFor(v6Primary(), stored)).toBe(stored);
    expect(LP.notesFor(ficoS612(), null)).toBeNull();
    expect(LP.notesFor(ficoS612(), GUIDE)).toBe(GUIDE);
  });

  test('WhatsApp: a 6-12 visit\'s notes send no lesson plan message; 1-5 still does', () => {
    const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
    const S = observeStrings('en');
    const stored = { ...GUIDE, lp_check: STORED_CHECK() };
    expect(LP.renderLpCheckMessage(LP.notesFor(ficoS612(), stored).lp_check, S)).toBe('');
    expect(LP.renderLpCheckMessage(LP.notesFor(v6Primary(), stored).lp_check, S)).toContain(S.lp_check_title);
  });
});

describe('the five-part judge never runs for a 6-12 visit', () => {
  const transcript = "Coach: Let's look at the We Do step of today's plan. What made partner practice hard today?";

  test('6-12 whose stored notes carry a check (written before this change): null, no model call', async () => {
    const complete = jest.fn(async () => ({ result: { parts: [] } }));
    const d = await LP.judgeDiscussion({ transcript, lpCheck: STORED_CHECK(), lang: 'en', sessionId: 'visit-612', session: ficoS612() }, { complete });
    expect(d).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  test('1-5 is unchanged: the judge runs once', async () => {
    const complete = jest.fn(async () => ({ result: { parts: LP.PARTS.map((part) => ({ part, covered: false, quote: '', what_happened: 'x' })) } }));
    const d = await LP.judgeDiscussion({ transcript, lpCheck: STORED_CHECK(), lang: 'ur', sessionId: 'visit-15', session: v6Primary() }, { complete });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(d).toMatchObject({ state: 'ok', covered: 0, total: 5 });
  });
});

describe('the 6-12 Feedback Form has no lesson plan moves step (pinned; coach and principal, portal and Flow)', () => {
  test('the FICO-S WhatsApp Flow: start, sections A-E one indicator a screen, the checklist, the feedback; nothing on the plan', () => {
    const Flow = require('../../bot/shared/services/observe/obs612/fico-s-flow');
    const ids = Flow.SCREENS ? Flow.SCREENS.map((s) => s.id) : Flow.PATH;
    expect(ids[0]).toBe('FS_START');
    expect(ids.slice(-2)).toEqual(['FS_CHECKLIST', 'FS_FEEDBACK']);
    expect(ids.filter((id) => /PLAN|MOVE|FID|LP/i.test(id))).toEqual([]);
  });
});
