'use strict';

/**
 * /observe2 — "What Rumi heard", the check a coach does after sealing the live form.
 *
 *   HEARD_ASK, HEARD_WRONG, HEARD_WORK, HEARD_EXPLAIN
 *       The moments Rumi found in the recording, grouped by the four moments. Each is a quote with
 *       its minute; the coach answers "yes, this happened" or "no, or not like this". Up to SLOTS
 *       per screen; unused slots are hidden.
 *   FIDELITY
 *       Only when the coach picked a lesson plan in the form and it was graded: each step the plan
 *       asked for, already rated from the recording by the grader /observe uses (done, done another
 *       way, partly, not done, couldn't tell), with what was seen. The coach changes any they saw
 *       differently and the same scorer re-scores it, as in /observe's Section B. Otherwise the last
 *       moments screen goes straight to the levels.
 *   ADDED_ONE, ADDED_TWO
 *       Every level, pre-selected with what the coach's sealed answers and confirmed moments add up
 *       to (rules.js). Rumi's own level is never shown. The coach changes any they disagree with.
 *   PRIORITY
 *       The pick the coach made before sealing, kept or changed, with one box for why.
 *   DONE
 *
 * Every footer is a data_exchange that posts every field on its screen, so the server holds each
 * screen's answers as they come (the per-screen buffer) and adds the levels up once the last moment
 * screen arrives.
 *
 * Regenerate the committed copy after any change:  node bot/scripts/generate-observe2-flow-json.js
 */

const { MOMENTS, PLAIN, EXTRA, ROW, PRIORITY } = require('./fico17');

const FLOW_VERSION = '7.3';
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
const ORDER = MOMENTS.flatMap((m) => m.codes);
const YES_NO = [{ id: 'yes', title: 'Yes, this happened' }, { id: 'no', title: 'No, or not like this' }];

function screenWith(id, title, children, footerLabel, data, initValues) {
  const fields = [];
  const collect = (list) => list.forEach((c) => {
    if (c.name) fields.push(c.name);
    ['then', 'else'].forEach((k) => Array.isArray(c[k]) && collect(c[k]));
  });
  collect(children);
  const payload = { screen: id };
  for (const f of fields) payload[f] = `\${form.${f}}`;
  const form = {
    type: 'Form',
    name: `${id.toLowerCase()}_form`,
    ...(initValues ? { 'init-values': initValues } : {}),
    children: [...children, { type: 'Footer', label: footerLabel, 'on-click-action': { name: 'data_exchange', payload } }],
  };
  return { id, title, data, layout: { type: 'SingleColumnLayout', children: [form] } };
}

function heardScreen({ id, title, moment }, isLast) {
  const data = {};
  const kids = [
    { type: 'TextHeading', text: MOMENT_BY_ID[moment].question },
    { type: 'TextCaption', text: 'These are moments from the recording. Say whether each one really happened. No score from the recording is shown.' },
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
  return screenWith(id, title, kids, 'Next', data);
}

function fidelityScreen() {
  const data = { fid_header: { type: 'string', __example__: 'The plan asked for 9 steps. From the recording: 6 done, 1 partly (72%).' } };
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
  const kids = [{ type: 'TextCaption', text: 'Each level is what your answers and the moments you confirmed add up to. Change any you disagree with.' }];
  for (const code of codes) {
    data[`${code}_because`] = { type: 'string', __example__: 'Two open questions, each answered by one child.' };
    data[`${code}_level`] = { type: 'string', __example__: '3' };
    kids.push(
      { type: 'TextSubheading', text: ROW[code] },
      { type: 'TextCaption', text: `\${data.${code}_because}` },
      {
        type: 'RadioButtonsGroup', name: `${code}_final`, label: 'Level', required: true,
        'data-source': [...PLAIN[code].map((title, i) => ({ id: String(i + 1), title })), ...EXTRA.map(([eid, title]) => ({ id: eid, title }))],
      },
    );
    init[`${code}_final`] = `\${data.${code}_level}`;
  }
  return screenWith(id, title, kids, 'Next', data, init);
}

function priorityScreen() {
  const kids = [
    { type: 'TextCaption', text: "Your pick before you saw the recording's moments. Keep it or change it." },
    { type: 'Dropdown', name: 'priority_final', label: 'Work on first', required: true, 'data-source': ORDER.map((c) => ({ id: c, title: PRIORITY[c] })) },
    { type: 'TextArea', name: 'why', label: 'Why you changed', required: false, 'max-length': 600, 'helper-text': 'If you changed a level or the pick: which moment or answer did it' },
  ];
  return screenWith('PRIORITY', 'Work on first', kids, 'Submit', {
    priority_level: { type: 'string', __example__: 'C8' },
  }, { priority_final: '${data.priority_level}' });
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
    ...HEARD_SCREENS.map((h, i) => heardScreen(h, i === HEARD_SCREENS.length - 1)),
    fidelityScreen(),
    ...ADDED_SCREENS.map(addedScreen),
    priorityScreen(),
    done,
  ];
  const routing = {};
  screens.forEach((s, i) => { routing[s.id] = i < screens.length - 1 ? [screens[i + 1].id] : []; });
  // No plan picked, or none graded: the last moments screen goes straight to the levels.
  routing.HEARD_EXPLAIN = ['FIDELITY', 'ADDED_ONE'];
  return { version: FLOW_VERSION, data_api_version: '3.0', routing_model: routing, screens };
}

module.exports = { buildEvidenceCheckFlow, SLOTS, FIDELITY_SLOTS, FIDELITY_VERDICTS, HEARD_SCREENS, ADDED_SCREENS, FLOW_VERSION };
