'use strict';

/**
 * Synthetic FICO17 v5 /observe2 records (no real teacher or school) that the report tests run through the
 * brief, the focus-area text, the analysis and the teacher-report transformer. Their outputs at origin/sandbox
 * afeab2a69b, before the v6 report change, are pinned in report-v5-golden.json: a v5 visit must read the same,
 * byte for byte, after it (spec §0.3).
 */

const LEVELS = { C1: '3', C2: '2', C3: '3', C4: '2', C5: '2', C6: '4', C7: '3', C8: '3', D1: '3', D2: '4', D3: '1', D4: '3', D5: '2', F1: '3', F2: '2', F3: '2', F4: '1' };
const MOMENTS = [
  { id: 'ask_1', moment: 'ask', type: 'open_q_one', minute: '00:40', quote: 'Why do plants need sunlight?', label: 'open question' },
  { id: 'wrong_1', moment: 'wrong', type: 'hedged', minute: '07:02', quote: 'Maybe it is twelve?', label: 'unsure answer' },
  { id: 'work_1', moment: 'work', type: 'choice', minute: '12:10', quote: 'You can draw it or write it.', label: 'real choice' },
];
const FIDELITY = {
  status: 'ok', fidelity_pct: 60, prescribed_count: 5,
  moves: [
    { move_id: 'm1', phase: 'warm_up', counted: true, verdict: 'executed', text: 'Sing the counting song' },
    { move_id: 'm2', phase: 'explain', counted: true, verdict: 'executed', text: 'Show tens and ones with sticks' },
    { move_id: 'm3', phase: 'guided', counted: true, verdict: 'partial', text: 'Pairs make 23 with sticks' },
    { move_id: 'm4', phase: 'independent', counted: true, verdict: 'executed', text: 'Workbook page 12' },
    { move_id: 'm5', phase: 'exit', counted: true, verdict: 'not_done', text: 'Exit ticket: write 47 in tens and ones' },
  ],
};

const base = (patch = {}) => ({
  id: 'form-v5', rubric_version: 'fico-ict-17-2026-09', period_minutes: 40,
  answers: { lp: 'used', lp_ref: 'lp-1', priority: 'C5', p2_think: ['why', 'own_example'], p1_notes: 'Children at the back could not see the board.', p2_task: 'some' },
  final_levels: { ...LEVELS },
  rumi_moments: { moments: MOMENTS, fidelity: FIDELITY },
  evidence_review: { heard_ask_1: 'yes', heard_wrong_1: 'yes', heard_work_1: 'no', priority_final: 'C5', also_final: ['wait', 'plan'], why: 'The pairs were louder than the recording.' },
  ...patch,
});

const FORMS = {
  full: base(),
  na_ie_pick: base({
    final_levels: { ...LEVELS, C7: 'NA', D3: 'IE', C1: 'IE' },
    evidence_review: { heard_ask_1: 'yes', priority_final: 'C7', also_final: ['manage', 'D3'] },
  }),
  plan_none: base({ answers: { lp: 'none', priority: 'plan' }, rumi_moments: { moments: [] }, evidence_review: { priority_final: 'plan', also_final: ['close', 'warmup'] } }),
  wait_low: base({
    final_levels: { ...LEVELS, C1: '1', D1: '2', C5: 'NA' },
    evidence_review: { heard_ask_1: 'yes', priority_final: 'wait', also_final: ['rules', 'C8'], added_hole: { C1: 'one open question' }, added: { C1: '1' } },
  }),
  nothing_high: base({ final_levels: Object.fromEntries(Object.keys(LEVELS).map((c) => [c, '2'])), evidence_review: { priority_final: 'C1' } }),
};

const CALLS = [
  ['full', { teacherName: 'Teacher A' }],
  ['full', { lang: 'ur' }],
  ['na_ie_pick', {}],
  ['na_ie_pick', { lang: 'ur' }],
  ['plan_none', {}],
  ['wait_low', {}],
  ['wait_low', { lang: 'ur' }],
  ['nothing_high', {}],
];

module.exports = { FORMS, CALLS };
