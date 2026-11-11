'use strict';
/**
 * bd-ra8xu.46 — the HITL report of a FICO17 v6 coach visit shows the evidence AS THE COACH SUBMITTED IT, with the
 * level the coach selected. Operator 11 Nov ~21:20: "for an HITL report show the evidence submitted by the coach, not
 * Rumi's. Rumi's gets overwritten by the coach anyways." ~21:30: "it works like how it works in Observe 2 right now.
 * The coach can modify whatever the evidence was submitted to them by Rumi, and whatever is submitted by the coach,
 * whether it be directly from Rumi or if overwritten by them, we will show that to the teacher, as well as the grades
 * that were selected by the coach ... for the case of DC, we just show them whatever evidence Rumi presents with no
 * grades."
 *
 * In the teacher report, debrief and PDF of a v6 /observe or /observe2 visit:
 *   /observe  — each of the 11 shows the text in its Evidence box as the coach submitted it (Rumi's pre-filled text the
 *               coach kept, or the coach's edit), with the coach's level; a level the coach changed also carries the
 *               coach's reason. A combined indicator shows the coach's level and the coach's own written
 *               justification, never Rumi's evidence.
 *   /observe2 — each indicator shows what the coach confirmed or added (the moments the coach confirmed, the moments
 *               the coach added, the coach's room notes), with the coach's level; a changed level or a combined
 *               indicator leads with the coach's own words. Rumi's unconfirmed moments are never shown.
 * Rumi's evidence stays stored beside the coach's (rumi_evidence; analysis_data.combined_evidence) for calibration.
 * The DC's own self-recording report is unchanged: the 11 levels, the combined indicators as Rumi's evidence, no level.
 * The report's framework label is the framework and its version only: "FICO17 v6".
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const V6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const fw = require('../../bot/shared/services/coaching/frameworks/fico17-v6-framework');
const O6 = require('../../bot/shared/services/observe/observe-fico17-v6');
const { transformFICO17V6ToReportData } = require('../../bot/shared/services/coaching/report-transformers/fico17-v6-report-transformer');
const { transformFICOToReportData } = require('../../bot/shared/services/coaching/report-transformers/fico-report-transformer');
const { buildTeacherReport } = require('../../bot/shared/services/coaching/frameworks/fico17-v6/teacher-report');
const { buildAnalysis } = require('../../bot/shared/services/observe/observe2/analysis');

const RUMI_C3 = 'Ali, what do you think?';
const RUMI_C1 = 'Why does a plant need water?';
const RUMI_F1 = 'Two plus three makes five.';
const RUMI_F2 = 'Addition means putting together.';
const COACH_C3 = 'Named Ali and Sara before asking, and pointed to the back row once.';
const COACH_C1 = 'She asked why twice and followed up on the answer.';
const COACH_F2_EDIT = 'She explained "sum" with counters on the desk, then asked two children to say it.';
const COACH_C1_EDIT = 'At 03:10 she asked why a plant needs water, then asked Sara how she knew.';

function dcAnalysis() {
  const levels = {};
  const quote = { C1: RUMI_C1, F1: RUMI_F1, F2: RUMI_F2 };
  for (const c of V6.DC_CODES) levels[c] = { result: 2, because: `Rumi heard ${c}`, evidence: [{ time: '03:10', quote: quote[c] || 'Okay.' }] };
  const raw = {
    levels,
    combined_evidence: {
      C3: { result: null, items: [{ time: '05:10', quote: RUMI_C3, kind: 'name_called' }] },
      C5: { result: null, items: [] }, C7: { result: null, items: [] }, D3: { result: 'NA', items: [] }, D4: { result: 'IE', items: [] },
      D2: { student_turns_first_half: 30, student_turns_second_half: 12 },
    },
  };
  return { ...fw.computeScores(raw), framework: fw.name };
}

// What the review Flow submits: every Evidence box as the form shows it (pre-filled with Rumi's text), so a box the
// coach left alone comes back with Rumi's text and an edited one with the coach's.
function submitted(changes = {}) {
  const a = dcAnalysis();
  const out = {};
  for (const l of ['C', 'D', 'F']) {
    const pre = O6.buildScreenPrefill(a, l);
    for (const code of V6.SECTIONS[l].codes) if (!V6.isCombined(code)) out[`ev_${code}`] = pre[`e_${code}`];
  }
  return { ...out, ...changes };
}

const LEVELS = {
  r_C1: '4', r_C2: '2', r_C4: '2', r_C6: '2', r_C8: '2', chg_C: COACH_C1,
  r_C3: '3', why_C3: COACH_C3, r_C5: '2', why_C5: 'The switch took about three minutes.', r_C7: 'NA', why_C7: 'No group task in the lesson.',
  r_D1: '2', r_D5: '2', d2_children: '4', d2_quiet_later: '0', r_D2: '3', why_D2: 'Four children answered, front rows.',
  r_D3: 'NA', why_D3: 'No child spoke to another child.', r_D4: '2', why_D4: 'They answered only when sure.',
  r_F1: '2', r_F2: '2', r_F3: '2', r_F4: '2',
};

function reviewed(edits) {
  const v2 = dcAnalysis();
  const v1 = JSON.parse(JSON.stringify(v2));
  const review = O6.buildReview(v2, edits);
  O6.applyReview(v2, review, edits, v1);
  return v2;
}
const rowOf = (a, code) => a.domains[V6.SECTIONS[code[0]].domain].indicators.find((r) => r.id === code);
const shownOf = (r) => JSON.stringify({ e: r.evidence, s: r.evidence_summary, sw: r.evidence_sw, i: r.evidence_items });

describe('/observe v6: the stored rows carry the evidence as the coach submitted it', () => {
  const kept = () => reviewed({ ...LEVELS, ...submitted() });
  const edited = () => reviewed({ ...LEVELS, ...submitted({ ev_F2: COACH_F2_EDIT, ev_C1: COACH_C1_EDIT }) });

  test('one of the 11 whose Evidence box the coach edited shows the coach\'s text, never Rumi\'s', () => {
    const r = rowOf(edited(), 'F2');
    expect(r.score).toBe(2);
    expect(r.evidence).toBe(COACH_F2_EDIT);
    expect(r.evidence_summary).toBe(COACH_F2_EDIT);
    expect(shownOf(r)).not.toContain(RUMI_F2);
    expect(r.rumi_evidence).toContain(RUMI_F2); // kept for calibration
  });
  test('one of the 11 whose Evidence box the coach left as Rumi filled it shows Rumi\'s text, as the coach kept it', () => {
    const r = rowOf(kept(), 'F1');
    expect(r.set_by).toBe('rumi');
    expect(r.evidence).toContain(RUMI_F1);
  });
  test('a level the coach changed keeps the coach\'s level and the evidence the coach submitted', () => {
    const r = rowOf(edited(), 'C1');
    expect(r.score).toBe(4);
    expect(r.set_by).toBe('coach');
    expect(r.because).toBe(COACH_C1);
    expect(r.evidence).toBe(COACH_C1_EDIT);
    expect(r.rumi_evidence).toContain(RUMI_C1);
  });
  test('a combined indicator shows the coach\'s justification, never Rumi\'s evidence', () => {
    const r = rowOf(kept(), 'C3');
    expect(r.evidence).toBe(COACH_C3);
    expect(r.evidence_summary).toBe(COACH_C3);
    expect(shownOf(r)).not.toContain(RUMI_C3);
    expect(r.rumi_evidence).toContain(RUMI_C3);
  });
  test('Rumi\'s combined evidence is still stored for calibration', () => {
    expect(kept().combined_evidence.C3.items[0].quote).toBe(RUMI_C3);
  });
  test('only a real edit counts as a text change', () => {
    const v2 = dcAnalysis();
    const v1 = JSON.parse(JSON.stringify(v2));
    const edits = { ...LEVELS, ...submitted({ ev_F2: COACH_F2_EDIT }) };
    const { textChanged } = O6.applyReview(v2, O6.buildReview(v2, edits), edits, v1);
    expect(textChanged).toBe(1);
  });
  test('a review form opened again still labels Rumi\'s evidence as Rumi\'s, never the coach\'s words', () => {
    const a = edited();
    delete a.levels.F2.because; // Rumi gave no reason line; the form falls back to the stored row
    const pre = O6.buildScreenPrefill(a, 'F');
    expect(pre.e_F2).not.toContain(COACH_F2_EDIT);
    expect(pre.e_F2).toContain(RUMI_F2);
  });
});

describe('/observe v6: the teacher report (PDF / record) shows the evidence as the coach submitted it', () => {
  const rd = transformFICO17V6ToReportData({ created_at: '2026-11-11T05:00:00Z' }, 'T',
    reviewed({ ...LEVELS, ...submitted({ ev_F2: COACH_F2_EDIT, ev_C1: COACH_C1_EDIT }) }));
  const crit = (code) => rd.goals.flatMap((g) => g.criteria).find((c) => c.name.startsWith(`${code} `));
  test('edited: the coach\'s text with the level the coach kept', () => {
    expect(crit('F2').score).toBe(2);
    expect(crit('F2').evidence).toContain(COACH_F2_EDIT);
    expect(crit('F2').evidence).not.toContain(RUMI_F2);
  });
  test('kept: Rumi\'s text, as the coach submitted it', () => {
    expect(crit('F1').evidence).toContain(RUMI_F1);
  });
  test('changed: the coach\'s level, the coach\'s reason and the coach\'s evidence; never Rumi\'s', () => {
    expect(crit('C1').score).toBe(4);
    expect(crit('C1').evidence).toContain(COACH_C1);
    expect(crit('C1').evidence).toContain(COACH_C1_EDIT);
    expect(crit('C1').evidence).not.toContain(RUMI_C1);
  });
  test('combined: the coach\'s level and justification only', () => {
    expect(crit('C3').score).toBe(3);
    expect(crit('C3').evidence).toContain(COACH_C3);
    expect(crit('C3').evidence).not.toContain(RUMI_C3);
  });
  test('the label is the framework and its version only', () => {
    expect(rd.frameworkDisplayName).toBe('FICO17 v6');
  });
});

describe('/observe2 v6: the report rows carry what the coach confirmed or added', () => {
  const MOMENT_C1 = 'Why did the ice melt?';
  const MOMENT_C1_REJECTED = 'Is everyone listening?';
  const MOMENT_C8 = 'Take your counters and show me five.';
  const MOMENT_F4_ADDED = 'Like when your mother buys two kilos of flour.';
  const ROOM_C3 = 'Ahmed, you answer.';
  const form = () => ({
    id: 'f1', rubric_version: 'fico17_v6', answers: { priority: 'C1' },
    final_levels: { C1: '4', C2: '2', C3: '3', C4: '2', C5: '2', C6: '2', C7: 'NA', C8: '3', D1: '2', D2: '3', D3: 'NA', D4: '2', D5: '2', F1: '3', F2: '2', F3: '2', F4: '3' },
    rumi_moments: {
      moments: [
        { id: 'm1', type: 'probe', minute: '04:10', quote: MOMENT_C1 },
        { id: 'm2', type: 'probe', minute: '06:00', quote: MOMENT_C1_REJECTED },
        { id: 'm3', type: 'resource_used', minute: '09:30', quote: MOMENT_C8 },
        { id: 'm4', type: 'name_called', minute: '05:10', quote: ROOM_C3 },
      ],
    },
    evidence_review: {
      heard_m1: 'yes', heard_m2: 'no', heard_m3: 'yes',
      missed: [{ id: 'missed_1', type: 'life_link', minute: 12, quote: MOMENT_F4_ADDED, source: 'coach', confirmed: true }],
      priority_final: 'C1',
      v6_levels: {
        C3: { level: 3, set_by: 'coach', source: 'coach', because: COACH_C3, rubric: 'fico17_v6' },
        C1: { level: 4, set_by: 'coach', because: COACH_C1, rubric: 'fico17_v6' },
        F1: { level: 3, set_by: 'rumi', rubric: 'fico17_v6' },
      },
    },
  });
  const a = buildAnalysis(form(), {});
  const row = (code) => Object.values(a.domains).flatMap((d) => d.indicators || []).find((r) => r.id === code);
  test('combined: the coach\'s justification leads, Rumi\'s unconfirmed room evidence is never shown', () => {
    expect(row('C3').evidence.startsWith(COACH_C3)).toBe(true);
    expect(row('C3').evidence_summary).toBe(row('C3').evidence);
    expect(row('C3').evidence).not.toContain(ROOM_C3);
  });
  test('changed: the coach\'s reason, then the moments the coach confirmed for it; never one the coach rejected', () => {
    expect(row('C1').score).toBe(4);
    expect(row('C1').evidence.startsWith(COACH_C1)).toBe(true);
    expect(row('C1').evidence).toContain(MOMENT_C1);
    expect(row('C1').evidence).not.toContain(MOMENT_C1_REJECTED);
  });
  test('unchanged: the level as it reads today (what was seen and confirmed)', () => {
    expect(row('F1').evidence).toContain(V6.TITLES.F1[2]);
  });
  test('a v6 moment the coach confirmed is shown on its indicator', () => {
    expect(row('C8').evidence).toContain(MOMENT_C8);
  });
  test('a moment the coach added is shown on its indicator', () => {
    expect(row('F4').evidence).toContain(MOMENT_F4_ADDED);
  });
  test('the PDF prints the coach\'s evidence and labels the framework and version only', () => {
    const rd = transformFICOToReportData({ created_at: '2026-11-11T05:00:00Z' }, 'T', a);
    // By its name, with or without the code in front (a branch without the spec §9.3 report still prefixes it).
    const crit = rd.goals.flatMap((g) => g.criteria).find((c) => c.name === row('C1').name || c.name === `C1 ${row('C1').name}`);
    expect(crit.evidence.startsWith(COACH_C1)).toBe(true);
    expect(rd.frameworkDisplayName).toBe('FICO17 v6');
  });
});

describe('/observe2 v5 stays as it was', () => {
  test('a v5 visit\'s row reads the level phrase and the confirmed moments, with no coach-added moments', () => {
    const f = {
      id: 'f5', rubric_version: 'fico-ict-17-2026-09', answers: { priority: 'C1' },
      final_levels: { C1: '3', C2: '2', C3: '2', C4: '2', C5: '2', C6: '2', C7: '2', C8: '2', D1: '2', D2: '2', D3: '2', D4: '2', D5: '2', F1: '3', F2: '2', F3: '2', F4: '2' },
      rumi_moments: { moments: [{ id: 'm1', type: 'probe', minute: '04:10', quote: 'Why?' }] },
      evidence_review: { heard_m1: 'yes', missed: [{ id: 'missed_1', type: 'probe', minute: 3, quote: 'Not on v5', source: 'coach' }] },
    };
    const a = buildAnalysis(f, {});
    const c1 = Object.values(a.domains).flatMap((d) => d.indicators || []).find((r) => r.id === 'C1');
    expect(c1.evidence).toContain('Heard: 04:10 "Why?"');
    expect(c1.evidence).not.toContain('Not on v5');
    expect(transformFICOToReportData({ created_at: '2026-11-11T05:00:00Z' }, 'T', a).frameworkDisplayName).toBe('FICO Framework');
  });
});

describe('the DC\'s own self-recording report is unchanged', () => {
  test('combined indicators are Rumi\'s evidence with no level', () => {
    const a = dcAnalysis();
    const r = buildTeacherReport(a.levels, { language: 'en', combinedEvidence: a.combined_evidence });
    expect(r.text).toContain(`05:10 "${RUMI_C3}"`);
    expect(r.evidence_rows.find((x) => x.code === 'C3').result).toBeUndefined();
  });
});
