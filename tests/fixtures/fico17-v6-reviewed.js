'use strict';
/**
 * bd-ra8xu.40 — a FICO17 v6 /observe visit as the teacher report and the debrief read it, built through the production
 * code: the DC scorer's computeScores on a model reply (Rumi's 11 levels and the combined evidence), then the coach's
 * review Flow values through observe-fico17-v6 buildReview + applyReview. dcV6() is the DC self-recording before any
 * review: the six combined indicators have no level.
 *
 * Final levels after the review. The lowest and the highest tie on purpose, to pin the tie-breaks:
 *   C1 3 · C2 NA · C3 2 · C4 1 (the coach changed Rumi's 2) · C5 3 · C6 4 · C7 NA · C8 IE
 *   D1 3 · D2 3 · D3 1 · D4 3 · D5 1 · F1 4 · F2 3 · F3 2 · F4 2
 * No text here spells an indicator code, so a test can say "no code reached the prompt".
 */
const V6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const fw = require('../../bot/shared/services/coaching/frameworks/fico17-v6-framework');
const O6 = require('../../bot/shared/services/observe/observe-fico17-v6');

const RUMI = {
  C1: [3, 'The teacher asked open questions and waited for answers.', '04:10', 'Why does the plant need water?'],
  C2: ['NA', 'No answer in the lesson was wrong.', '05:00', 'Good, that is right.'],
  C4: [2, 'Children chose only who went first.', '07:20', 'Who wants to go first?'],
  C6: [4, 'Wrong answers were thanked and other views invited.', '09:05', 'Thank you Bilal, who sees it differently?'],
  C8: ['IE', 'The recording was unclear while the chart was used.', '11:30', 'Look at the chart.'],
  D1: [3, 'Two children explained why in their own words.', '12:40', 'Because the roots drink the water.'],
  D5: [1, 'No child asked a question of their own.', '14:00', 'Is it twelve?'],
  F1: [4, 'The teacher warned about a common mix-up before it happened.', '15:10', 'Many people think roots eat soil, but they do not.'],
  F2: [3, 'Subject words were explained twice.', '16:20', 'Absorb means to soak up.'],
  F3: [2, 'One reason was given; the rest was the rule to remember.', '17:30', 'Just remember this.'],
  F4: [2, 'A link to home was mentioned and dropped.', '18:40', 'Like the plants at your home.'],
};
const RUMI_COMBINED_QUOTE = 'Ali, what do you think?';

// The coach's own words, as submitted on the review Flow.
const COACH = {
  C3: 'Named Ali once before a question, then took whoever called out.',
  C5: 'Pens down and books open took under two minutes after the clap.',
  C7: 'There was no pair or group task in this lesson.',
  D2: 'Four different children answered, all from the front rows.',
  D3: "No child answered or added to another child's answer.",
  D4: 'Two children tried while unsure; Bilal changed his answer halfway.',
  CHANGE_C: 'Sana offered her own way to count and it was not taken up.',
  EV_C4: 'You decided every step; when Sana offered her own way to count the sticks, it was set aside.',
};

const TRANSCRIPT = [
  '[00:30] Teacher: Assalam o alaikum children. Today we learn what plants need to grow.',
  '[04:10] Teacher: Why does the plant need water?',
  '[04:20] Student: Because the roots drink the water.',
  '[07:20] Teacher: Who wants to go first?',
  '[09:05] Teacher: Thank you Bilal, who sees it differently?',
  '[12:40] Student: Because the roots drink the water and the leaves get it.',
  '[15:10] Teacher: Many people think roots eat soil, but they do not.',
  '[16:20] Teacher: Absorb means to soak up.',
  '[18:40] Teacher: Like the plants at your home.',
].join('\n');

function rumiReply() {
  const levels = {};
  for (const [code, [result, because, time, quote]] of Object.entries(RUMI)) {
    levels[code] = { result, because, evidence: [{ time, quote }] };
  }
  return {
    levels,
    combined_evidence: {
      C3: { result: null, items: [{ time: '05:10', quote: RUMI_COMBINED_QUOTE, kind: 'name_called' }] },
      C5: { result: null, items: [{ time: '14:02', quote: 'Pens down, now open your books.', kind: 'signal' }] },
      C7: { result: null, items: [] },
      D3: { result: 'NA', items: [] },
      D4: { result: null, items: [] },
      D2: { student_turns_first_half: 18, student_turns_second_half: 9 },
    },
  };
}

/** The DC's own v6 analysis of a self-recording, before any review. */
function dcV6() {
  return { ...fw.computeScores(rumiReply()), framework: fw.name };
}

// What the review Flow submits: every Evidence box as the form shows it (pre-filled with Rumi's text) unless changed.
function submitted(a, changes = {}) {
  const out = {};
  for (const l of ['C', 'D', 'F']) {
    const pre = O6.buildScreenPrefill(a, l);
    for (const code of V6.SECTIONS[l].codes) if (!V6.isCombined(code)) out[`ev_${code}`] = pre[`e_${code}`];
  }
  return { ...out, ...changes };
}

const LEVEL_EDITS = {
  r_C1: '3', r_C2: 'NA', r_C4: '1', r_C6: '4', r_C8: 'IE', chg_C: COACH.CHANGE_C,
  r_C3: '2', why_C3: COACH.C3, r_C5: '3', why_C5: COACH.C5, r_C7: 'NA', why_C7: COACH.C7,
  r_D1: '3', r_D5: '1', d2_children: '4', d2_quiet_later: '0', r_D2: '3', why_D2: COACH.D2,
  r_D3: '1', why_D3: COACH.D3, r_D4: '3', why_D4: COACH.D4,
  r_F1: '4', r_F2: '3', r_F3: '2', r_F4: '2',
};

/**
 * The analysis_data of a reviewed v6 /observe visit.
 * @param {object} [changes] review Flow values to override (e.g. { ev_C4: '' } for a box the coach cleared)
 */
function reviewedV6(changes = {}) {
  const v2 = dcV6();
  const v1 = JSON.parse(JSON.stringify(v2));
  const edits = { ...LEVEL_EDITS, ...submitted(v1, { ev_C4: COACH.EV_C4, ...changes }) };
  const review = O6.buildReview(v2, edits);
  O6.applyReview(v2, review, edits, v1);
  v2.topic = 'What plants need';
  return v2;
}

const rowOf = (a, code) => a.domains[V6.SECTIONS[code[0]].domain].indicators.find((r) => r.id === code);

module.exports = { RUMI, RUMI_COMBINED_QUOTE, COACH, TRANSCRIPT, dcV6, reviewedV6, rowOf };
