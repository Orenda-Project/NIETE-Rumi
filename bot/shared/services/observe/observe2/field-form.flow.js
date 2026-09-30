'use strict';

/**
 * /observe2 — the live field form, as a WhatsApp Flow.
 *
 * The coach opens it when the lesson starts and fills it in while watching:
 *   PART_1  the first half of the period   (numbers + a few taps; "Part 1 done" saves it)
 *   PART_2  the second half                (the same questions, plus children speaking for the first time)
 *   AFTER   before leaving the room        (anything to report, photos, what to work on first, the seal)
 *   SEALED  the record is locked
 *
 * Every question describes something the coach can SEE, in plain words; no indicator name or
 * level ever appears while the lesson is on. The ids behind each option are the ones
 * rules.js turns into a level, and the contract test keeps the two in step.
 *
 * Each footer is a data_exchange: the endpoint checks the answers, saves the part with the server
 * time (the end of Part 1 is the halfway mark), and either sends the next screen or returns this one
 * with messages under the fields (Form error-messages).
 *
 * Regenerate the committed copy after any change:  node bot/scripts/generate-observe2-flow-json.js
 */

const { PRIORITY, MOMENTS } = require('./fico17');

const FLOW_VERSION = '7.3';

const opt = (id, title, description) => ({ id, title, ...(description ? { description } : {}) });

const WHO_ASKED = [
  opt('hands', 'Only raised hands', 'The teacher only asked children who put a hand up.'),
  opt('once', 'One child without a hand up', 'Once, the teacher asked a child who had not put a hand up.'),
  opt('often', 'Several without hands up', 'More than once, the teacher asked children who had not put a hand up.'),
  opt('varied', 'Several ways to include all', "For example: said the child's name before the question, pair talk, everyone writes an answer, name sticks."),
];
const TOGETHER = [
  opt('none', 'No, alone or whole class', 'No pair or group task in this part.'),
  opt('alone', 'Sat together, worked alone', 'Children sat in pairs or groups, but each did their own work.'),
  opt('combine', 'Made one thing together', 'The task needed the group to work together, e.g. one chart or one answer per group.'),
  opt('roles', 'Had roles and reported back', 'Each child had a job, and the group told the class what they did.'),
  opt('cannot', "The room can't seat groups", 'Fixed benches, or no space to sit together.'),
];
const LISTENED = [
  opt('turns', 'Each spoke, no one replied', 'Children spoke in turn but did not answer each other.'),
  opt('once', 'One child replied to another', "Once, a child answered or added to another child's idea."),
  opt('often', 'Replied to each other often', "Two or more times, children answered or added to each other's ideas."),
  opt('agreed', 'Disagreed, then agreed', 'Children gave reasons, questioned each other and agreed on one answer.'),
];
const MATERIALS = [
  opt('none', 'Nobody, though they would help', 'No book, board, chart or objects were used, though they would have helped.'),
  opt('teacher', 'Only the teacher', 'The teacher showed or wrote; the children did not touch them.'),
  opt('children', 'The children used them', 'Children used books, cards or objects, or wrote on the board.'),
  opt('explain', 'Children explained with them', 'A child used a material to show or explain their thinking.'),
  opt('nofit', 'Nothing suits this topic', 'No material would help with this topic.'),
];
const SWITCHED = [
  opt('stalled', 'No signal, children drifted', 'The teacher gave no signal; children kept talking or wandering, and the lesson stopped.'),
  opt('slow', 'Signal, but slow to settle', 'The teacher gave a signal, but many children took more than a minute or had to be called back.'),
  opt('clear', 'Settled within a minute', 'The teacher gave a clear signal and the children were ready within about a minute.'),
  opt('ahead', 'Ready before being told', 'The teacher said what comes next beforehand; children moved without being told one by one.'),
];
const INCIDENT = [
  opt('none', 'Nothing to report'),
  opt('sarcastic', 'Praise that sounded mocking', "Words like 'well done' said in a way that made fun of a child."),
  opt('ridicule', 'A child was shamed or mocked', 'Any ridicule, humiliation or threat towards a child.'),
  opt('error', 'Wrong fact left uncorrected', 'The teacher said or wrote something wrong and did not correct it.'),
  opt('tech', 'The recording failed', 'The recorder stopped, or nothing was recorded.'),
];
const LESSON_PLAN = [
  opt('used', 'Followed a lesson plan'),
  opt('notfollowed', "Had one, didn't follow it"),
  opt('none', 'No plan for this lesson'),
];
const YES_NO = [opt('yes', 'Yes'), opt('no', 'No')];

const ERR_DATA = {
  error_messages: { type: 'object', __example__: {} },
  error: { type: 'string', __example__: '' },
  has_error: { type: 'boolean', __example__: false },
};
const ERR_LINE = { type: 'TextBody', text: '${data.error}', visible: '${data.has_error}' };

const radio = (name, label, options, description) => ({
  type: 'RadioButtonsGroup', name, label, required: true, 'data-source': options, ...(description ? { description } : {}),
});
const number = (name, label, helper) => ({ type: 'TextInput', name, label, 'input-type': 'number', required: true, 'helper-text': helper });

function partQuestions(p) {
  return [
    radio(`${p}_picked`, 'Who did the teacher ask?', WHO_ASKED),
    radio(`${p}_groups`, 'Did children work together?', TOGETHER),
    {
      type: 'If',
      condition: `\${form.${p}_groups} != 'none' && \${form.${p}_groups} != 'cannot'`,
      then: [
        { type: 'CheckboxGroup', name: `${p}_listen`, label: 'When you sat with a group', description: 'Tick everything you saw', required: false, 'data-source': LISTENED },
        { type: 'TextInput', name: `${p}_listen_other`, label: 'Something else', required: false, 'helper-text': 'What the children did, in a few words' },
      ],
      else: [],
    },
    radio(`${p}_materials`, 'Who used books or materials?', MATERIALS),
    radio(`${p}_change`, 'Did the class switch activity?', YES_NO, 'For example: from listening to writing, or into groups.'),
    {
      type: 'If',
      condition: `\${form.${p}_change} == 'yes'`,
      then: [radio(`${p}_change_how`, 'What happened at the switch?', SWITCHED, 'If there was more than one switch, pick what happened most.')],
      else: [],
    },
    { type: 'TextArea', name: `${p}_notes`, label: 'Anything else', required: false, 'max-length': 600, 'helper-text': 'The minute and what you saw, e.g. 8 min: board wiped before copying' },
    ERR_LINE,
  ];
}

const FIELDS = {
  PART_1: ['present', 'p1_spoke', 'p1_picked', 'p1_groups', 'p1_listen', 'p1_listen_other', 'p1_materials', 'p1_change', 'p1_change_how', 'p1_notes'],
  PART_2: ['p2_spoke', 'p2_new', 'p2_picked', 'p2_groups', 'p2_listen', 'p2_listen_other', 'p2_materials', 'p2_change', 'p2_change_how', 'p2_notes'],
  AFTER: ['incident', 'detail', 'note', 'lp', 'priority', 'seal_ok'],
};

function screen(id, title, children, footerLabel, extraData) {
  const payload = { screen: id };
  for (const f of FIELDS[id]) payload[f] = `\${form.${f}}`;
  if (id === 'AFTER') payload.photos = '${form.photos}';
  return {
    id,
    title,
    data: { ...(extraData || {}), ...ERR_DATA },
    layout: {
      type: 'SingleColumnLayout',
      children: [{
        type: 'Form',
        name: `${id.toLowerCase()}_form`,
        'error-messages': '${data.error_messages}',
        children: [...children, { type: 'Footer', label: footerLabel, 'on-click-action': { name: 'data_exchange', payload } }],
      }],
    },
  };
}

// The priority list follows the four moments, so related choices sit together.
const PRIORITY_ORDER = MOMENTS.flatMap((m) => m.codes);

function buildFieldFormFlow() {
  const part1 = [
    { type: 'TextHeading', text: 'Fill this in as you watch' },
    { type: 'TextSubheading', text: '${data.teacher_line}' },
    { type: 'TextCaption', text: '${data.part_hint}' },
    number('present', 'Children present', 'Everyone in class today'),
    number('p1_spoke', 'Children who spoke', 'Count each child once. You can change it as you go.'),
    ...partQuestions('p1'),
  ];
  const part2 = [
    { type: 'TextHeading', text: 'Part 2: keep going' },
    { type: 'TextCaption', text: '${data.part_hint}' },
    number('p2_spoke', 'Children who spoke', 'Count each child once, including those from Part 1'),
    number('p2_new', 'First time speaking', "Of these, how many hadn't spoken in Part 1?"),
    ...partQuestions('p2'),
  ];
  const after = [
    { type: 'TextHeading', text: 'Before you seal' },
    { type: 'TextCaption', text: 'About two minutes, before you leave the room.' },
    radio('incident', 'Anything to report?', INCIDENT),
    {
      type: 'If',
      condition: "${form.incident} != 'none'",
      then: [{ type: 'TextArea', name: 'detail', label: 'What happened, when', required: true, 'max-length': 600, 'helper-text': 'The words used and the minute' }],
      else: [],
    },
    { type: 'TextArea', name: 'note', label: 'Only you could see', required: false, 'max-length': 600, 'helper-text': "What a recorder can't catch: the back rows, the board, how the class reacted" },
    radio('lp', 'Lesson plan', LESSON_PLAN),
    {
      type: 'PhotoPicker', name: 'photos', label: 'Photos (optional)', description: 'Boards, notebooks, groups at work. Never faces.',
      'photo-source': 'camera_gallery', 'min-uploaded-photos': 0, 'max-uploaded-photos': 9, 'max-file-size-kb': 10240,
    },
    { type: 'Dropdown', name: 'priority', label: 'Work on first', required: true, 'data-source': PRIORITY_ORDER.map((c) => opt(c, PRIORITY[c])) },
    { type: 'OptIn', name: 'seal_ok', label: "Seal this record. I can't change it afterwards, and Rumi's findings open only after I seal.", required: true },
    ERR_LINE,
  ];
  const sealed = {
    id: 'SEALED',
    title: 'Sealed',
    terminal: true,
    success: true,
    data: {
      sealed_line: { type: 'string', __example__: 'Sealed at 10:39' },
      next_line: { type: 'string', __example__: 'Next: send me the recording.' },
      extension_message_response: {
        type: 'object',
        properties: { params: { type: 'object' } },
        __example__: { params: { observe2_action: 'sealed' } },
      },
    },
    layout: {
      type: 'SingleColumnLayout',
      children: [
        { type: 'TextHeading', text: '${data.sealed_line}' },
        { type: 'TextBody', text: '${data.next_line}' },
        { type: 'Footer', label: 'Done', 'on-click-action': { name: 'complete', payload: { extension_message_response: '${data.extension_message_response}' } } },
      ],
    },
  };
  return {
    version: FLOW_VERSION,
    data_api_version: '3.0',
    routing_model: { PART_1: ['PART_2'], PART_2: ['AFTER'], AFTER: ['SEALED'], SEALED: [] },
    screens: [
      screen('PART_1', 'Part 1', part1, 'Part 1 done', {
        teacher_line: { type: 'string', __example__: "Rabia's lesson · Grade 4 · Maths" },
        part_hint: { type: 'string', __example__: 'Minutes 0 to 20. Tap "Part 1 done" at minute 20; your answers are saved then.' },
      }),
      screen('PART_2', 'Part 2', part2, 'Part 2 done', {
        part_hint: { type: 'string', __example__: 'Minutes 20 to 40. Answer only for what happens in this part.' },
      }),
      screen('AFTER', 'Before you seal', after, 'Seal and send'),
      sealed,
    ],
  };
}

module.exports = { buildFieldFormFlow, FIELDS, FLOW_VERSION };
