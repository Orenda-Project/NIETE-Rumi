'use strict';

/**
 * /observe2 — "What Rumi heard", the check a coach does after sealing the live form.
 *
 *   HEARD_ASK, HEARD_WRONG, HEARD_WORK, HEARD_EXPLAIN
 *       The moments Rumi found in the recording, grouped by the four moments. Each is a quote with
 *       its minute; the coach answers "yes, this happened" or "no, or not like this". Up to SLOTS
 *       per screen; unused slots are hidden.
 *   ADDED_1, ADDED_2
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

const HEARD_SCREENS = [
  { id: 'HEARD_ASK', title: 'Rumi heard: asking', moment: 'ask' },
  { id: 'HEARD_WRONG', title: 'Rumi heard: wrong answers', moment: 'wrong' },
  { id: 'HEARD_WORK', title: 'Rumi heard: working', moment: 'work' },
  { id: 'HEARD_EXPLAIN', title: 'Rumi heard: explaining', moment: 'explain' },
];
const MOMENT_BY_ID = Object.fromEntries(MOMENTS.map((m) => [m.id, m]));
const ADDED_SCREENS = [
  { id: 'ADDED_1', title: 'Added up: asking, wrong', codes: [...MOMENT_BY_ID.ask.codes, ...MOMENT_BY_ID.wrong.codes] },
  { id: 'ADDED_2', title: 'Added up: working, explaining', codes: [...MOMENT_BY_ID.work.codes, ...MOMENT_BY_ID.explain.codes] },
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
    { type: 'TextCaption', text: 'These are moments from the recording. Say whether each one really happened. Rumi never shows its own score.' },
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
  return screenWith(id, title, kids, isLast ? 'Add it all up' : 'Next', data);
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
    { type: 'TextCaption', text: 'Your pick before you saw anything from Rumi. Keep it or change it.' },
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
    ...ADDED_SCREENS.map(addedScreen),
    priorityScreen(),
    done,
  ];
  const routing = {};
  screens.forEach((s, i) => { routing[s.id] = i < screens.length - 1 ? [screens[i + 1].id] : []; });
  return { version: FLOW_VERSION, data_api_version: '3.0', routing_model: routing, screens };
}

module.exports = { buildEvidenceCheckFlow, SLOTS, HEARD_SCREENS, ADDED_SCREENS, FLOW_VERSION };
