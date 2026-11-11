'use strict';

/**
 * /observe2 — "What Rumi heard", the check a coach does after sealing the live form.
 *
 *   HEARD_ASK, HEARD_WRONG, HEARD_WORK, HEARD_EXPLAIN
 *       The moments Rumi found in the recording, grouped by the four moments. Each is a quote with
 *       its minute and why it was picked; the coach answers "yes, this happened" or "no, or not like
 *       this". Up to SLOTS per screen; unused slots are hidden. A line from the endpoint opens each
 *       screen: how the moments count, or that Rumi found none for this question.
 *   FIDELITY
 *       Only when the coach picked a lesson plan in the form and it was graded: each step the plan
 *       asked for, already rated from the recording by the grader /observe uses (done, done another
 *       way, partly, not done, couldn't tell), with what was seen. The coach changes any they saw
 *       differently and the same scorer re-scores it, as in /observe's Section B. Otherwise the last
 *       moments screen goes straight to the levels.
 *   COMBINED_ONE, COMBINED_TWO, COMBINED_THREE   (FICO17 v6 visits only, bd-ra8xu.38)
 *       The six indicators the coach sets from the room (C3 C5 / C7 D3 / D4 D2): each its v6 definition, what
 *       the recording showed for it and what the coach adds, a level that starts BLANK, and a required reason
 *       (20+ characters, checked by the endpoint). D2 also takes the two child counts. A v5 visit never sees them.
 *   ADDED_DC_ONE, ADDED_DC_TWO   (v6 visits only)
 *       Rumi's other 11 levels, pre-selected as ADDED_* are, with the v6 titles; one box per screen for why
 *       the coach changed any (required by the endpoint only when a level was changed).
 *   ADDED_ONE, ADDED_TWO
 *       Every level, pre-selected with what the coach's sealed answers and confirmed moments add up
 *       to (rules.js). Rumi's own level is never shown. The coach changes any they disagree with.
 *   PRIORITY
 *       The coach's own notes from the visit, read-only (R23), then the picks the coach made before
 *       sealing (the first, and up to two more), kept or changed, with one box for why. The lists are the
 *       seal screen's: the 17, the plan's steps and the coaching focus areas (fico17 FOCUS_ORDER).
 *   DONE
 *
 * Every footer is a data_exchange that posts every field on its screen, so the server holds each
 * screen's answers as they come (the per-screen buffer) and adds the levels up once the last moment
 * screen arrives.
 *
 * Regenerate the committed copy after any change:  node bot/scripts/generate-observe2-flow-json.js
 */

const { MOMENTS, PLAIN, EXTRA, ROW, FOCUS, FOCUS_DESCRIPTION, FOCUS_ORDER, ALSO_NONE, THINKING } = require('./fico17');
const V6 = require('../../coaching/frameworks/fico17-v6');

const FLOW_VERSION = '7.3';
// This check's own version, sent by the footers whose next screen's data changed (ADDED_TWO, PRIORITY):
// 2 brought "Also work on" and the plan's steps (R14), 3 the coaching focus areas in the PRIORITY lists
// (R20, R21). A check opened on an older Flow sends its own version, or none, and the endpoint pre-fills
// its PRIORITY screen only with what that version's lists have.
const CHECK_VERSION = '3';
const SLOTS = 8;
// One slot per prescribed move, as many as /observe shows (observe-draft MAX_MOVE_SLOTS); moves past
// the twelfth keep the grader's rating there too.
const FIDELITY_SLOTS = 12;
// The verdicts /observe's scorer reads, in plain words; the description says what each counts for.
const FIDELITY_VERDICTS = [
  { id: 'executed', title: 'Done as planned', description: 'Counts in full.' },
  { id: 'substituted_equivalent', title: 'Done another way, as good', description: 'Counts in full.' },
  { id: 'substituted_better', title: 'Done another way, better', description: 'Counts in full.' },
  { id: 'partial', title: 'Partly done', description: 'Counts half.' },
  { id: 'not_done', title: 'Not done', description: 'Counts nothing.' },
  { id: 'not_adjudicable', title: "Couldn't tell", description: 'Left out of the result.' },
];

const HEARD_SCREENS = [
  { id: 'HEARD_ASK', title: 'Recording: asking', moment: 'ask' },
  { id: 'HEARD_WRONG', title: 'Recording: wrong answers', moment: 'wrong' },
  { id: 'HEARD_WORK', title: 'Recording: working', moment: 'work' },
  { id: 'HEARD_EXPLAIN', title: 'Recording: explaining', moment: 'explain' },
];
const MOMENT_BY_ID = Object.fromEntries(MOMENTS.map((m) => [m.id, m]));
const ADDED_SCREENS = [
  { id: 'ADDED_ONE', title: 'Added up: asking, wrong', codes: [...MOMENT_BY_ID.ask.codes, ...MOMENT_BY_ID.wrong.codes] },
  { id: 'ADDED_TWO', title: 'Added up: working, explaining', codes: [...MOMENT_BY_ID.work.codes, ...MOMENT_BY_ID.explain.codes] },
];
// FICO17 v6 (bd-ra8xu.38). The last moments screen posts V6_CHECK, so the endpoint knows this Flow has the v6
// screens: a v6 visit opened on a Flow published before them runs on the v5 screens rather than break.
const V6_CHECK = '1';
const COMBINED_SCREENS = [
  { id: 'COMBINED_ONE', title: 'From the room (1 of 3)', codes: ['C3', 'C5'] },
  { id: 'COMBINED_TWO', title: 'From the room (2 of 3)', codes: ['C7', 'D3'] },
  { id: 'COMBINED_THREE', title: 'From the room (3 of 3)', codes: ['D4', 'D2'] },
];
const dcOnly = (codes) => codes.filter((c) => V6.isDc(c));
const ADDED6_SCREENS = [
  { id: 'ADDED_DC_ONE', title: "Rumi's levels (1 of 2)", codes: dcOnly([...MOMENT_BY_ID.ask.codes, ...MOMENT_BY_ID.wrong.codes]), why: 'why6_one' },
  { id: 'ADDED_DC_TWO', title: "Rumi's levels (2 of 2)", codes: dcOnly([...MOMENT_BY_ID.work.codes, ...MOMENT_BY_ID.explain.codes]), why: 'why6_two' },
];
const ERR = { error_messages: { type: 'object', __example__: {} } };
const ORDER = MOMENTS.flatMap((m) => m.codes);
const YES_NO = [{ id: 'yes', title: 'Yes, this happened' }, { id: 'no', title: 'No, or not like this' }];

function screenWith(id, title, children, footerLabel, data, initValues, extraPayload, withErrors) {
  const fields = [];
  const collect = (list) => list.forEach((c) => {
    if (c.name) fields.push(c.name);
    ['then', 'else'].forEach((k) => Array.isArray(c[k]) && collect(c[k]));
  });
  collect(children);
  const payload = { screen: id, ...(extraPayload || {}) };
  for (const f of fields) payload[f] = `\${form.${f}}`;
  const form = {
    type: 'Form',
    name: `${id.toLowerCase()}_form`,
    ...(initValues ? { 'init-values': initValues } : {}),
    ...(withErrors ? { 'error-messages': '${data.error_messages}' } : {}),
    children: [...children, { type: 'Footer', label: footerLabel, 'on-click-action': { name: 'data_exchange', payload } }],
  };
  return { id, title, data, layout: { type: 'SingleColumnLayout', children: [form] } };
}

// The line under each moments screen's question comes from the endpoint, so a part with no moment says
// so instead of showing the question over nothing (pilot sheet R8, R9; bd-eal7zn.3). A check opened on a
// Flow published before this line was declared ignores it and keeps today's screen.
function heardScreen({ id, title, moment }) {
  const intro = `${id.toLowerCase()}_intro`;
  const data = {
    [intro]: { type: 'string', __example__: 'These moments were picked from the recording as evidence for this part of the lesson. Say whether each one happened as written.' },
  };
  const kids = [
    { type: 'TextHeading', text: MOMENT_BY_ID[moment].question },
    { type: 'TextBody', text: `\${data.${intro}}` },
  ];
  for (let i = 1; i <= SLOTS; i += 1) {
    const k = `${id.toLowerCase()}_${i}`;
    data[`${k}_t`] = { type: 'string', __example__: '12:41 · open question' };
    data[`${k}_d`] = { type: 'string', __example__: '"Why is two quarters the same as one half?"' };
    data[`${k}_v`] = { type: 'boolean', __example__: true };
    kids.push({
      type: 'RadioButtonsGroup', name: k, label: `\${data.${k}_t}`, description: `\${data.${k}_d}`,
      visible: `\${data.${k}_v}`, required: false, 'data-source': YES_NO,
    });
  }
  return screenWith(id, title, kids, 'Next', data, null, id === 'HEARD_EXPLAIN' ? { v6c: V6_CHECK } : null);
}

function fidelityScreen() {
  const data = { fid_header: { type: 'string', __example__: 'The plan has 9 steps; 8 count toward the result.\nFrom the recording: 6 done, 1 partly, 1 not done (81%).' } };
  const init = {};
  const kids = [
    { type: 'TextHeading', text: 'Did the lesson follow the plan?' },
    { type: 'TextBody', text: '${data.fid_header}' },
  ];
  for (let k = 1; k <= FIDELITY_SLOTS; k += 1) {
    data[`mv_${k}`] = { type: 'string', __example__: `Step ${k} of 9 · Warm-up: Show two fraction strips and ask what the children notice.\nFrom the recording: the teacher showed the strips and asked.` };
    data[`mv_${k}_v`] = { type: 'boolean', __example__: k === 1 };
    data[`fr_${k}`] = { type: 'string', __example__: 'executed' };
    data[`fe_${k}`] = { type: 'string', __example__: '[00:10] What do you notice about the two strips?' };
    kids.push(
      { type: 'TextBody', text: `\${data.mv_${k}}`, visible: `\${data.mv_${k}_v}` },
      { type: 'RadioButtonsGroup', name: `fid_r_${k}`, label: 'What happened', required: false, visible: `\${data.mv_${k}_v}`, 'data-source': FIDELITY_VERDICTS },
      {
        type: 'TextArea', name: `fid_e_${k}`, label: 'What you saw', required: false, visible: `\${data.mv_${k}_v}`,
        'max-length': 600, 'helper-text': `Step ${k}: the minute and the words, if you have them`,
      },
    );
    init[`fid_r_${k}`] = `\${data.fr_${k}}`;
    init[`fid_e_${k}`] = `\${data.fe_${k}}`;
  }
  return screenWith('FIDELITY', 'Lesson plan steps', kids, 'Add it all up', data, init);
}

function addedScreen({ id, title, codes }) {
  const data = {};
  const init = {};
  const kids = [{ type: 'TextCaption', text: 'Each level is what your answers and the moments you confirmed add up to. Change any you disagree with. Rows marked "Thinking" show whether children reasoned, or only recalled.' }];
  for (const code of codes) {
    data[`${code}_because`] = { type: 'string', __example__: 'Two open questions, each answered by one child.' };
    data[`${code}_level`] = { type: 'string', __example__: '3' };
    kids.push(
      // The six indicators that score thinking are named as such (R16); the screens and fields are unchanged.
      { type: 'TextSubheading', text: THINKING.codes.includes(code) ? `${THINKING.name}: ${ROW[code]}` : ROW[code] },
      { type: 'TextCaption', text: `\${data.${code}_because}` },
      {
        type: 'RadioButtonsGroup', name: `${code}_final`, label: 'Level', required: true,
        'data-source': [...PLAIN[code].map((title, i) => ({ id: String(i + 1), title })), ...EXTRA.map(([eid, title]) => ({ id: eid, title }))],
      },
    );
    init[`${code}_final`] = `\${data.${code}_level}`;
  }
  // The last level screen's answer is the PRIORITY screen, whose data changed with "Also work on".
  const last = id === ADDED_SCREENS[ADDED_SCREENS.length - 1].id;
  return screenWith(id, title, kids, 'Next', data, init, last ? { cv: CHECK_VERSION } : null);
}

// One indicator the coach sets from the room (v6): name, definition + the recording's evidence + what the coach
// adds (one TextBody from the endpoint), the level with no init-value, the reason.
function combinedBlock(code, data, init) {
  const ind = V6.indicator(code);
  data[`${code}_ev`] = { type: 'string', __example__: `${ind.definition}\n\nThe recording showed nothing for this.\n\nCoach adds: ${ind.coach_adds}` };
  const kids = [{ type: 'TextSubheading', text: ind.name }, { type: 'TextBody', text: `\${data.${code}_ev}` }];
  if (code === 'D2') {
    // No init-value: Meta takes a number there and a visit may have no count to give. What the coach typed on
    // the live form is in the TextBody above instead (the endpoint's D2_ev).
    kids.push(
      { type: 'TextInput', name: 'd2_children', label: 'Children who spoke', 'input-type': 'number', required: true, 'helper-text': 'Count each child once, whole lesson. Not chorus.' },
      { type: 'TextInput', name: 'd2_quiet_later', label: 'Quiet, then spoke', 'input-type': 'number', required: true, 'helper-text': 'Silent in the first half, spoke in the second' },
    );
  }
  kids.push(
    { type: 'RadioButtonsGroup', name: `cmb_${code}_level`, label: 'Level', required: true, 'data-source': V6.levelOptions(code) },
    { type: 'TextArea', name: `cmb_${code}_why`, label: 'Why this level', required: true, 'max-length': 600, 'helper-text': "What you saw, and how it fits the DC's evidence" },
  );
  return kids;
}

function combinedScreen({ id, title, codes }) {
  const data = { ...ERR };
  const init = {};
  const kids = [{ type: 'TextCaption', text: 'Set each level from what you saw in the room. Nothing is chosen for you. Every level needs a reason.' }];
  for (const code of codes) kids.push(...combinedBlock(code, data, init));
  return screenWith(id, title, kids, 'Next', data, Object.keys(init).length ? init : null, null, true);
}

// Rumi's 11 (v6): pre-selected, v6 titles, NA and couldn't-tell kept so any pre-filled value is on the list.
const V6_EXTRA = [{ id: 'NA', title: 'N/A · No chance to see it' }, { id: 'IE', title: "Couldn't tell" }];
function added6Screen({ id, title, codes, why }) {
  const data = { ...ERR };
  const init = {};
  const kids = [{ type: 'TextCaption', text: "Rumi's level for each, from your answers and the moments you confirmed. Change any you saw differently, and say why below." }];
  for (const code of codes) {
    data[`${code}_because`] = { type: 'string', __example__: 'Two open questions, each answered by one child.' };
    data[`${code}_level`] = { type: 'string', __example__: '3' };
    kids.push(
      { type: 'TextSubheading', text: V6.indicator(code).name },
      { type: 'TextCaption', text: `\${data.${code}_because}` },
      { type: 'RadioButtonsGroup', name: `${code}_final`, label: 'Level', required: true, 'data-source': [...V6.levelOptions(code), ...V6_EXTRA] },
    );
    init[`${code}_final`] = `\${data.${code}_level}`;
  }
  kids.push({ type: 'TextArea', name: why, label: 'Why you changed', required: false, 'max-length': 600, 'helper-text': 'Needed only if you changed a level: what you saw' });
  return screenWith(id, title, kids, 'Next', data, init, id === ADDED6_SCREENS[ADDED6_SCREENS.length - 1].id ? { cv: CHECK_VERSION } : null, true);
}

function priorityScreen() {
  const focus = FOCUS_ORDER.map((c) => ({ id: c, title: FOCUS[c], ...(FOCUS_DESCRIPTION[c] ? { description: FOCUS_DESCRIPTION[c] } : {}) }));
  const also = [{ id: ALSO_NONE, title: 'Nothing else' }, ...focus];
  const kids = [
    // The coach's own notes from the visit, read-only (R23): the talk with the teacher often runs while
    // this check is open. Hidden when nothing was typed.
    { type: 'TextSubheading', text: 'Your notes, as you wrote them', visible: '${data.notes_v}' },
    { type: 'TextBody', text: '${data.notes_body}', visible: '${data.notes_v}' },
    { type: 'TextCaption', text: "Your picks before you saw the recording's moments. Keep them or change them." },
    { type: 'Dropdown', name: 'priority_final', label: 'Work on first', required: true, 'data-source': focus },
    { type: 'TextCaption', text: 'If the teacher needs more, up to two. Optional.' },
    { type: 'Dropdown', name: 'also_final_1', label: 'Also work on', required: false, 'data-source': also },
    { type: 'Dropdown', name: 'also_final_2', label: 'And also', required: false, 'data-source': also },
    { type: 'TextArea', name: 'why', label: 'Why you changed', required: false, 'max-length': 600, 'helper-text': 'If you changed a level or the pick: which moment or answer did it' },
  ];
  return screenWith('PRIORITY', 'Work on first', kids, 'Submit', {
    priority_level: { type: 'string', __example__: 'C8' },
    also_level_1: { type: 'string', __example__: 'plan' },
    also_level_2: { type: 'string', __example__: 'none' },
    notes_v: { type: 'boolean', __example__: true },
    notes_body: { type: 'string', __example__: 'Part 1\n8 min: board wiped before the children copied it\n\nPart 2\nThree at the back had no task' },
  }, {
    priority_final: '${data.priority_level}', also_final_1: '${data.also_level_1}', also_final_2: '${data.also_level_2}',
  }, { cv: CHECK_VERSION });
}

function buildEvidenceCheckFlow() {
  const done = {
    id: 'DONE',
    title: 'Done',
    terminal: true,
    success: true,
    // Flat keys in the complete payload (see field-form.flow.js); token <userId>:observe2-check:<recordId>.
    data: {
      done_line: { type: 'string', __example__: 'Saved at 10:52' },
      next_line: { type: 'string', __example__: 'Your brief for the conversation with the teacher is on its way.' },
      record_id: { type: 'string', __example__: '00000000-0000-4000-8000-000000000000' },
    },
    layout: {
      type: 'SingleColumnLayout',
      children: [
        { type: 'TextHeading', text: '${data.done_line}' },
        { type: 'TextBody', text: '${data.next_line}' },
        { type: 'Footer', label: 'Done', 'on-click-action': { name: 'complete', payload: { observe2: 'checked', record_id: '${data.record_id}' } } },
      ],
    },
  };
  const screens = [
    ...HEARD_SCREENS.map(heardScreen),
    fidelityScreen(),
    ...ADDED_SCREENS.map(addedScreen),
    priorityScreen(),
    done,
  ];
  const routing = {};
  screens.forEach((s, i) => { routing[s.id] = i < screens.length - 1 ? [screens[i + 1].id] : []; });
  // No plan picked, or none graded: the last moments screen goes straight to the levels.
  routing.HEARD_EXPLAIN = ['FIDELITY', 'ADDED_ONE'];
  // FICO17 v6 (bd-ra8xu.38): appended after DONE so every v5 screen keeps its place. A v6 visit goes
  // HEARD_EXPLAIN → COMBINED_ONE..3 → FIDELITY (a graded plan) or ADDED_DC_ONE → ADDED_DC_TWO → PRIORITY.
  const v6 = [...COMBINED_SCREENS.map(combinedScreen), ...ADDED6_SCREENS.map(added6Screen)];
  screens.push(...v6);
  routing.HEARD_EXPLAIN = [...routing.HEARD_EXPLAIN, 'COMBINED_ONE'];
  routing.COMBINED_ONE = ['COMBINED_TWO'];
  routing.COMBINED_TWO = ['COMBINED_THREE'];
  routing.COMBINED_THREE = ['FIDELITY', 'ADDED_DC_ONE'];
  routing.FIDELITY = [...routing.FIDELITY, 'ADDED_DC_ONE'];
  routing.ADDED_DC_ONE = ['ADDED_DC_TWO'];
  routing.ADDED_DC_TWO = ['PRIORITY'];
  return { version: FLOW_VERSION, data_api_version: '3.0', routing_model: routing, screens };
}

module.exports = {
  buildEvidenceCheckFlow, SLOTS, FIDELITY_SLOTS, FIDELITY_VERDICTS, HEARD_SCREENS, ADDED_SCREENS, FLOW_VERSION, CHECK_VERSION,
  V6_CHECK, COMBINED_SCREENS, ADDED6_SCREENS,
};
