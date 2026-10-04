'use strict';

/**
 * /observe2 — the live field form, as a WhatsApp Flow.
 *
 * The coach opens it when the lesson starts and fills it in while watching:
 *   PART_ONE     the first half of the period   (numbers + a few taps; "Part 1 done" saves it)
 *   PART_TWO     the second half                (the same questions, plus children speaking for the first time)
 *   LESSON_PLAN  which plan the lesson followed  (picked from the teacher's own recent plans, so the
 *                recording can be checked against it; go-live call, 2 Oct 2026). "Upload new" adds a plan
 *                the bot didn't give the teacher, the way /observe takes one:
 *   LP_PHOTOS    photos of the paper plan, one per page
 *   LP_FILE      a PDF or Word file
 *   LP_TEXT      the plan, typed
 *   PHOTOS       classroom photos: taken now, uploaded from the ones already on the phone, or none
 *                (Riffat, 4 Oct: coaches take photos at several moments of the lesson). A photo picker
 *                offers the gallery only on a phone; WhatsApp Web and Desktop show "Take photo" alone,
 *                so saved photos go through a file picker, which opens a chooser on every client:
 *   PHOTO_TAKE   the photo picker (camera, or the gallery on a phone)
 *   PHOTO_FILES  the file picker, images only
 *   AFTER        before leaving the room        (anything to report, what to work on first, the seal)
 *   SEALED       the record is locked
 *   CONTINUE     a reopened form: where the record stands, then on to the right screen
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

const { PRIORITY, MOMENTS, PLAIN } = require('./fico17');

const FLOW_VERSION = '7.3';
// Coaches photograph what helps the analysis, without the teachers' cap of three (2 Oct call).
const MAX_PHOTOS = 10;
// An added lesson plan: pages photographed, a file, or typed. The typed floor is the uploaded-plan
// extractor's own (lp-upload-extractor: under 40 characters there is nothing to read moves from).
const MAX_PLAN_PHOTOS = 10;
const MAX_PLAN_FILES = 3;
const LP_TEXT_MIN = 40;
const LP_TEXT_MAX = 600; // the TextArea cap the contract test holds every box to
const PHOTO_FILE_TYPES = ['image/jpeg', 'image/png'];
const PLAN_FILE_TYPES = [
  'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png',
];

const opt = (id, title, description) => ({ id, title, ...(description ? { description } : {}) });

const WHO_ASKED = [
  opt('hands', 'Only children with hands up', 'The teacher asked only children who had a hand up.'),
  opt('once', 'One child without a hand up', 'Once, the teacher asked a child who had not put a hand up.'),
  opt('often', 'Several without hands up', 'More than once, the teacher asked children who had not put a hand up.'),
  opt('varied', 'Other ways to include everyone', 'For example: names picked at random, talking to a partner first, or everyone writing an answer.'),
];
const TOGETHER = [
  opt('none', 'No, alone or as a whole class', 'No pair or group task in this part.'),
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
// The four titles are PLAIN.C5, word for word, so the level the coach later reviews reads the same.
const SWITCHED = [
  opt('stalled', PLAIN.C5[0], "The teacher didn't clearly say it was time to change. Children kept chatting or wandering, and the lesson stopped."),
  opt('slow', PLAIN.C5[1], 'The teacher said it was time to change, but many children took more than a minute or had to be called back.'),
  opt('clear', PLAIN.C5[2], 'The teacher said it was time to change, and nearly every child was on the new task within about a minute.'),
  opt('ahead', PLAIN.C5[3], 'The children already knew the routine and moved to the next task on their own, without being told one by one.'),
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
const PLAN_HOW = [
  opt('photos', 'Photos of the paper plan', `One photo per page, up to ${MAX_PLAN_PHOTOS}.`),
  opt('file', 'A PDF or Word file', "From the phone's files."),
  opt('text', 'Type it', 'The steps the teacher planned, in order.'),
];
const PHOTO_HOW = [
  opt('take', 'Take photos now', 'With the camera. On a phone you can also pick from the gallery.'),
  opt('files', 'Upload saved photos', 'Photos already taken: choose them from the gallery or files.'),
  opt('none', 'No photos'),
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
    // Two nested Ifs, not one "&&": Meta's condition parser mis-groups combined comparisons.
    {
      type: 'If',
      condition: `\${form.${p}_groups} != 'none'`,
      then: [{
        type: 'If',
        condition: `\${form.${p}_groups} != 'cannot'`,
        then: [
          { type: 'CheckboxGroup', name: `${p}_listen`, label: 'When you sat with a group', description: 'Tick everything you saw', required: false, 'data-source': LISTENED },
          { type: 'TextInput', name: `${p}_listen_other`, label: 'Something else', required: false, 'helper-text': 'What the children did, in a few words' },
        ],
        else: [],
      }],
      else: [],
    },
    radio(`${p}_materials`, 'Who used books or materials?', MATERIALS, 'Books, the board, charts, cards or objects.'),
    radio(`${p}_change`, 'Did the class switch activity?', YES_NO, 'For example: from listening to the teacher to writing, or from the whole class into groups.'),
    {
      type: 'If',
      condition: `\${form.${p}_change} == 'yes'`,
      then: [radio(`${p}_change_how`, 'How did the switch go?', SWITCHED, 'If the class switched more than once, pick what happened most often.')],
      else: [],
    },
    { type: 'TextArea', name: `${p}_notes`, label: 'Anything else', required: false, 'max-length': 600, 'helper-text': 'The minute and what you saw, e.g. 8 min: board wiped before copying' },
    ERR_LINE,
  ];
}

const FIELDS = {
  PART_ONE: ['present', 'p1_spoke', 'p1_picked', 'p1_groups', 'p1_listen', 'p1_listen_other', 'p1_materials', 'p1_change', 'p1_change_how', 'p1_notes'],
  PART_TWO: ['p2_spoke', 'p2_new', 'p2_picked', 'p2_groups', 'p2_listen', 'p2_listen_other', 'p2_materials', 'p2_change', 'p2_change_how', 'p2_notes'],
  LESSON_PLAN: ['lp', 'lp_pick', 'lp_how'],
  LP_PHOTOS: [],
  LP_FILE: [],
  LP_TEXT: ['lp_text'],
  PHOTOS: ['photo_how'],
  PHOTO_TAKE: [],
  PHOTO_FILES: [],
  AFTER: ['incident', 'detail', 'note', 'priority', 'seal_ok'],
};

function screen(id, title, children, footerLabel, extraData) {
  const payload = { screen: id };
  for (const f of FIELDS[id]) payload[f] = `\${form.${f}}`;
  // A picker's value may only travel as a top-level string property of a data_exchange (Meta).
  if (id === 'PHOTO_TAKE') payload.photos = '${form.photos}';
  if (id === 'PHOTO_FILES') payload.photo_files = '${form.photo_files}';
  if (id === 'LP_PHOTOS') payload.lp_photos = '${form.lp_photos}';
  if (id === 'LP_FILE') payload.lp_file = '${form.lp_file}';
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
    { type: 'TextBody', text: '${data.lp_line}' },
    { type: 'TextBody', text: '${data.photo_line}' },
    radio('incident', 'Anything to report?', INCIDENT, 'Something that should never happen in a classroom, or a recording that failed.'),
    {
      type: 'If',
      condition: "${form.incident} != 'none'",
      then: [{ type: 'TextArea', name: 'detail', label: 'What happened, when', required: true, 'max-length': 600, 'helper-text': 'The words used and the minute' }],
      else: [],
    },
    { type: 'TextArea', name: 'note', label: 'Not in the recording', required: false, 'max-length': 600, 'helper-text': "What you saw that a recording can't catch: the back rows, the board, reactions" },
    { type: 'Dropdown', name: 'priority', label: 'Work on first', required: true, 'data-source': PRIORITY_ORDER.map((c) => opt(c, PRIORITY[c])) },
    { type: 'OptIn', name: 'seal_ok', label: "Seal this record. I can't change it afterwards, and the recording's moments open only after I seal.", required: true },
    ERR_LINE,
  ];
  const plan = [
    { type: 'TextHeading', text: 'The lesson plan' },
    { type: 'TextCaption', text: 'So the recording can be checked against what the plan asked for.' },
    radio('lp', 'Was there a lesson plan?', LESSON_PLAN),
    {
      type: 'If',
      condition: "${form.lp} != 'none'",
      then: [
        { type: 'TextCaption', text: '${data.lp_hint}' },
        { type: 'Dropdown', name: 'lp_pick', label: 'Which plan?', required: false, 'data-source': '${data.lp_options}' },
        {
          type: 'If',
          condition: "${form.lp_pick} == 'upload'",
          then: [{ type: 'RadioButtonsGroup', name: 'lp_how', label: 'How will you add it?', required: false, 'data-source': PLAN_HOW }],
          else: [],
        },
      ],
      else: [],
    },
    ERR_LINE,
  ];
  // One picker per screen, and never a photo picker beside a file picker (Meta), so each way has its own screen.
  const planPhotos = [
    { type: 'TextHeading', text: 'Photos of the lesson plan' },
    { type: 'TextBody', text: 'One photo per page, in order. Hold the phone over the page so every line is sharp and nothing is cut off.' },
    {
      type: 'PhotoPicker', name: 'lp_photos', label: 'Pages of the plan', description: `Up to ${MAX_PLAN_PHOTOS}, in order.`,
      'photo-source': 'camera_gallery', 'min-uploaded-photos': 1, 'max-uploaded-photos': MAX_PLAN_PHOTOS, 'max-file-size-kb': 10240,
    },
    ERR_LINE,
  ];
  const planFile = [
    { type: 'TextHeading', text: 'The lesson plan file' },
    { type: 'TextBody', text: 'A PDF or Word file from the phone. A photo of the plan saved as a file works too.' },
    {
      type: 'DocumentPicker', name: 'lp_file', label: 'The plan', description: 'PDF or Word, up to 25 MB.',
      'min-uploaded-documents': 1, 'max-uploaded-documents': MAX_PLAN_FILES, 'max-file-size-kb': 25600, 'allowed-mime-types': PLAN_FILE_TYPES,
    },
    ERR_LINE,
  ];
  const planText = [
    { type: 'TextHeading', text: 'Type the lesson plan' },
    { type: 'TextBody', text: 'The steps the teacher planned, in order: how the lesson starts, what the teacher explains, what the children do, and how it ends.' },
    { type: 'TextArea', name: 'lp_text', label: 'The lesson plan', required: true, 'max-length': LP_TEXT_MAX, 'helper-text': 'One step per line is easiest to check.' },
    ERR_LINE,
  ];
  const photos = [
    { type: 'TextHeading', text: 'Classroom photos' },
    { type: 'TextBody', text: `Up to ${MAX_PHOTOS}. The ones that help: the board, the materials, children using them, groups at work, and the board at the end. Never faces.` },
    radio('photo_how', 'How will you add photos?', PHOTO_HOW),
    ERR_LINE,
  ];
  // One picker per screen (Meta), as for the plan.
  const photoTake = [
    { type: 'TextHeading', text: 'Take the photos' },
    {
      type: 'PhotoPicker', name: 'photos', label: 'Classroom photos', description: `Up to ${MAX_PHOTOS}.`,
      'photo-source': 'camera_gallery', 'min-uploaded-photos': 1, 'max-uploaded-photos': MAX_PHOTOS, 'max-file-size-kb': 10240,
    },
    ERR_LINE,
  ];
  const photoFiles = [
    { type: 'TextHeading', text: 'Upload saved photos' },
    { type: 'TextBody', text: 'Choose the photos you took during the lesson, from the gallery or the files. JPG or PNG.' },
    {
      type: 'DocumentPicker', name: 'photo_files', label: 'Classroom photos', description: `Up to ${MAX_PHOTOS}, 10 MB each.`,
      'min-uploaded-documents': 1, 'max-uploaded-documents': MAX_PHOTOS, 'max-file-size-kb': 10240, 'allowed-mime-types': PHOTO_FILE_TYPES,
    },
    ERR_LINE,
  ];
  const sealed = {
    id: 'SEALED',
    title: 'Sealed',
    terminal: true,
    success: true,
    // Flat keys in the complete payload, not extension_message_response: Meta drops the latter from a
    // completion, and the flow token (<userId>:observe2-form:<recordId>) is the second marker.
    data: {
      sealed_line: { type: 'string', __example__: 'Sealed at 10:39' },
      next_line: { type: 'string', __example__: 'Next: send me the recording.' },
      record_id: { type: 'string', __example__: '00000000-0000-4000-8000-000000000000' },
    },
    layout: {
      type: 'SingleColumnLayout',
      children: [
        { type: 'TextHeading', text: '${data.sealed_line}' },
        { type: 'TextBody', text: '${data.next_line}' },
        { type: 'Footer', label: 'Done', 'on-click-action': { name: 'complete', payload: { observe2: 'sealed', record_id: '${data.record_id}' } } },
      ],
    },
  };
  // The second entry screen. A form reopened after Part 1, after Part 2 or after the seal says where
  // the record stands; "Continue" posts only this screen's id and the endpoint sends the next screen.
  // (INIT may only answer with a screen that has no incoming route, so Part 2 cannot be opened directly.)
  const resume = {
    id: 'CONTINUE',
    title: 'Your record',
    data: {
      continue_heading: { type: 'string', __example__: 'Part 1 is saved' },
      continue_line: { type: 'string', __example__: 'Carry on with Part 2, from minute 20 to 40.' },
    },
    layout: {
      type: 'SingleColumnLayout',
      children: [
        { type: 'TextHeading', text: '${data.continue_heading}' },
        { type: 'TextBody', text: '${data.continue_line}' },
        { type: 'Footer', label: 'Continue', 'on-click-action': { name: 'data_exchange', payload: { screen: 'CONTINUE' } } },
      ],
    },
  };
  return {
    version: FLOW_VERSION,
    data_api_version: '3.0',
    routing_model: {
      PART_ONE: ['PART_TWO'],
      PART_TWO: ['LESSON_PLAN'],
      LESSON_PLAN: ['LP_PHOTOS', 'LP_FILE', 'LP_TEXT', 'PHOTOS'],
      LP_PHOTOS: ['PHOTOS'],
      LP_FILE: ['PHOTOS'],
      LP_TEXT: ['PHOTOS'],
      PHOTOS: ['PHOTO_TAKE', 'PHOTO_FILES', 'AFTER'],
      PHOTO_TAKE: ['AFTER'],
      PHOTO_FILES: ['AFTER'],
      AFTER: ['SEALED'],
      SEALED: [],
      CONTINUE: ['PART_TWO', 'LESSON_PLAN', 'PHOTOS', 'AFTER', 'SEALED'],
    },
    screens: [
      screen('PART_ONE', 'Part 1', part1, 'Part 1 done', {
        teacher_line: { type: 'string', __example__: "Rabia's lesson · Grade 4 · Maths" },
        part_hint: { type: 'string', __example__: 'Minutes 0 to 20. Tap "Part 1 done" at minute 20; your answers are saved then.' },
      }),
      screen('PART_TWO', 'Part 2', part2, 'Part 2 done', {
        part_hint: { type: 'string', __example__: 'Minutes 20 to 40. Answer only for what happens in this part.' },
      }),
      screen('LESSON_PLAN', 'Lesson plan', plan, 'Next', {
        lp_hint: { type: 'string', __example__: "Rabia's most recent plans from the bot. If the plan isn't here, pick \"Upload new\" to add it." },
        lp_options: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' } } },
          __example__: [
            { id: 'asset-1', title: 'Comparing & ordering un…', description: 'Grade 4 Math · Ch5 Day 3 · p.79-81 · today' },
            { id: 'upload', title: 'Upload new', description: 'Photos of a paper plan, a PDF or Word file, or typed text' },
          ],
        },
      }),
      screen('LP_PHOTOS', 'Plan photos', planPhotos, 'Next'),
      screen('LP_FILE', 'Plan file', planFile, 'Next'),
      screen('LP_TEXT', 'Type the plan', planText, 'Next'),
      screen('PHOTOS', 'Photos', photos, 'Next'),
      screen('PHOTO_TAKE', 'Take photos', photoTake, 'Next'),
      screen('PHOTO_FILES', 'Upload photos', photoFiles, 'Next'),
      screen('AFTER', 'Before you seal', after, 'Seal and send', {
        lp_line: { type: 'string', __example__: 'Lesson plan: Comparing & ordering unlike fractions, Grade 4 Math, Ch5 Day 3. To change it, go back.' },
        photo_line: { type: 'string', __example__: '3 photos added. To change them, go back.' },
      }),
      sealed,
      resume,
    ],
  };
}

module.exports = { buildFieldFormFlow, FIELDS, FLOW_VERSION, MAX_PHOTOS, MAX_PLAN_PHOTOS, MAX_PLAN_FILES, LP_TEXT_MIN };
