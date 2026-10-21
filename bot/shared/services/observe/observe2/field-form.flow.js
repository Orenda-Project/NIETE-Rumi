'use strict';

/**
 * /observe2 — the live field form, as a WhatsApp Flow.
 *
 * The coach opens it when the lesson starts and fills it in while watching. The parts follow the
 * 5-step lesson plan (warm-up, explanation, guided practice, independent practice, wrap-up), not the
 * clock (FICO pilot sheet R4/R10, 14 Oct; form version 5):
 *   PART_ONE     up to and including guided practice (numbers + a few taps; "Part 1 done" is tapped when
 *                independent practice starts, and saves it)
 *   PART_TWO     independent practice and the wrap-up: the children working on their own (a task each?
 *                what the teacher did meanwhile, checking with each child and re-teaching a common mistake
 *                among it, what children did when stuck), children speaking for the first time, the switches
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
 *   AFTER        before leaving the room        (anything to report, what to work on first and up to
 *                two more: the 17, the plan's steps, or a coaching focus area; the seal)
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

const { FOCUS, FOCUS_DESCRIPTION, FOCUS_ORDER, ALSO_NONE, PLAIN } = require('./fico17');

const FLOW_VERSION = '7.3';
// This form's own version, sent by the footers whose answer depends on it: 4 brought the photo step
// (the plan screens' next screen), 5 the parts by the lesson's steps (the parts' questions and checks),
// 6 Part 2's two checking moves (pilot sheet R4's comment). A form opened before a version was published
// sends an older one, or none, and the endpoint keeps it on its own routes and checks. Version 6 changes
// no route or check: the two ticks are only added, an older Flow cannot send them, and "While they worked,
// the teacher" sits inside an If, so it is never pre-filled and a newer tick never reaches an older list.
const FORM_VERSION = '6';
const VERSIONED = new Set(['PART_ONE', 'PART_TWO', 'LESSON_PLAN', 'LP_PHOTOS', 'LP_FILE', 'LP_TEXT', 'PHOTOS', 'PHOTO_TAKE', 'PHOTO_FILES']);
// Part 2 comes back with what was saved for it (Form init-values; pilot sheet R13). The screens that lead
// to Part 2 send this marker, and only then does the endpoint add Part 2's init values: a form opened on
// an older Flow sends none and gets the screens it knows. Kept apart from FORM_VERSION, so the pre-fill
// never depends on which version's Flow was published first.
const PREFILL = '1';
const PREFILL_FROM = new Set(['PART_ONE', 'PART_TWO']);
// Screens pre-filled from the stored answers. Only fields at the top of the form: Meta documents no rule
// for init-values on a field inside an If, and no Flow here does it.
const PREFILL_SCREENS = new Set(['PART_TWO']);
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
// "What was used?" (R17): the kind of materials, named on C8's line; who used them still sets the level.
// The ids are rules.js's USED_SAID.
const USED = [
  opt('book', 'Textbook or board'),
  opt('pictures', 'Charts or pictures'),
  opt('objects', 'Objects or manipulatives', 'Things to hold and move: counters, blocks, sticks, cards.'),
  opt('made', 'Materials the teacher made', 'Prepared or adapted by the teacher for this lesson.'),
];
// Part 2: the children working on their own. The ids are rules.js's TASK, TEACHER_SAID and STUCK.
const TASK = [
  opt('all', 'Every child had a task', 'Each child worked on their own: in a notebook, on a sheet or at the board.'),
  opt('some', 'Only some children', 'Some had a task of their own; others waited, watched or copied.'),
  opt('none', 'No work on their own', 'The class only listened, answered together or copied from the board.'),
];
// Asking each child, and re-teaching a mistake to the class, since form version 6 (pilot sheet R4's
// comment: the check for understanding during independent practice, then revising the misconceptions seen).
const TEACHER_WHILE = [
  opt('round', 'Went round the room'),
  opt('checked', 'Looked at their work', 'Read what children wrote or did, not only asked "Done?"'),
  opt('cfu', 'Asked children one by one', 'Whether they understood or needed help: a check for understanding.'),
  opt('helped', 'Helped those who were stuck', 'Explained again, or gave a hint or a smaller step, to a child who was stuck.'),
  opt('reteach', 'Re-explained a common mistake', 'Stopped the class and explained again, in a new way, a mistake many children made.'),
  opt('more', 'Gave more to early finishers', 'A harder or extra task for children who finished.'),
  opt('front', 'Stayed at the front', 'At the desk or the board while the children worked.'),
];
// The four titles are PLAIN.D4, word for word, so the level the coach later reviews reads the same.
const STUCK = [
  opt('waited', PLAIN.D4[0], 'Children stopped, copied a neighbour, or waited for the teacher to give the answer.'),
  opt('sure', PLAIN.D4[1], 'Those who knew it worked on; the ones who were not sure sat and waited.'),
  opt('unsure', PLAIN.D4[2], 'Two or more children who were not sure still had a go.'),
  opt('kept', PLAIN.D4[3], 'As well as that, a child carried on after a wrong answer, or started without being told.'),
  opt('easy', 'Nobody got stuck', 'The work was easy for everyone, so no one had to try while unsure.'),
];
// "What children's work showed" (R16): recall, or the kinds of reasoning the rubric scores. The ids are
// rules.js's THINK_SAID.
const THINK = [
  opt('recall', 'Repeated or copied it', 'Gave back what was taught: copied, recited, or the same answer as the example.'),
  opt('why', 'Explained why or how', 'A child said why an answer is right, or how they worked it out.'),
  opt('new', 'Solved a new problem', 'Worked out a question unlike the examples shown in class.'),
  opt('ownq', 'Asked a question about it', 'How, why or what if. Not "which page?" or "in the copy?"'),
  opt('apply', 'Their own example or link', 'Gave their own example, or linked it to daily life or another subject.'),
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

// The switch question, in both parts.
function switchQuestions(p, description) {
  return [
    radio(`${p}_change`, 'Did the class switch activity?', YES_NO, description),
    {
      type: 'If',
      condition: `\${form.${p}_change} == 'yes'`,
      then: [radio(`${p}_change_how`, 'How did the switch go?', SWITCHED, 'If the class switched more than once, pick what happened most often.')],
      else: [],
    },
  ];
}

const notes = (p) => ({ type: 'TextArea', name: `${p}_notes`, label: 'Anything else', required: false, 'max-length': 600, 'helper-text': 'The minute and what you saw, e.g. 8 min: board wiped before copying' });

// Part 1: warm-up, explanation and guided practice, while the teacher leads.
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
    // Two nested Ifs, as above: shown once materials were used.
    {
      type: 'If',
      condition: `\${form.${p}_materials} != 'none'`,
      then: [{
        type: 'If',
        condition: `\${form.${p}_materials} != 'nofit'`,
        then: [{ type: 'CheckboxGroup', name: `${p}_used`, label: 'What was used?', description: 'Tick everything used.', required: true, 'data-source': USED }],
        else: [],
      }],
      else: [],
    },
    ...switchQuestions(p, 'For example: from listening to the teacher to writing, or from the whole class into groups.'),
    notes(p),
    ERR_LINE,
  ];
}

// Part 2: independent practice and the wrap-up. Every question is about the children working on their
// own (R4/R10); who was picked, group work and materials are Part 1's.
function workAloneQuestions() {
  return [
    radio('p2_task', 'Did each child have a task?', TASK, 'A task of their own, to do without the teacher.'),
    {
      type: 'If',
      condition: "${form.p2_task} != 'none'",
      then: [
        { type: 'CheckboxGroup', name: 'p2_teacher', label: 'While they worked, the teacher', description: 'Tick everything you saw', required: true, 'data-source': TEACHER_WHILE },
        radio('p2_stuck', 'When the work got hard', STUCK, 'What did the children do when they were not sure?'),
      ],
      else: [],
    },
    { type: 'CheckboxGroup', name: 'p2_think', label: "What children's work showed", description: 'Tick everything you saw in this part: repeating, or reasoning.', required: true, 'data-source': THINK },
    ...switchQuestions('p2', 'For example: from group practice to working alone, or from working alone to the wrap-up.'),
    notes('p2'),
    ERR_LINE,
  ];
}

const FIELDS = {
  PART_ONE: ['present', 'p1_spoke', 'p1_picked', 'p1_groups', 'p1_listen', 'p1_listen_other', 'p1_materials', 'p1_used', 'p1_change', 'p1_change_how', 'p1_notes'],
  PART_TWO: ['p2_spoke', 'p2_new', 'p2_task', 'p2_teacher', 'p2_stuck', 'p2_think', 'p2_change', 'p2_change_how', 'p2_notes'],
  LESSON_PLAN: ['lp', 'lp_pick', 'lp_how'],
  LP_PHOTOS: [],
  LP_FILE: [],
  LP_TEXT: ['lp_text'],
  PHOTOS: ['photo_how'],
  PHOTO_TAKE: [],
  PHOTO_FILES: [],
  AFTER: ['incident', 'detail', 'note', 'priority', 'also_1', 'also_2', 'seal_ok'],
};

// What the parts posted before form version 5: a form still on that Flow keeps sending these, and the
// endpoint keeps them (Store.pick takes the two lists together).
const FIELDS_V4 = {
  PART_TWO: ['p2_spoke', 'p2_new', 'p2_picked', 'p2_groups', 'p2_listen', 'p2_listen_other', 'p2_materials', 'p2_change', 'p2_change_how', 'p2_notes'],
};

// Which fields come back pre-filled. Not a count (a number TextInput): Meta takes a number there (its
// validator refused a string on 15 Oct 2026: "Expected property 'p2_spoke' to be of type 'number' but
// found 'string'") and has no empty number. null fails validation, '' is a string, and 0 would put a
// wrong count in front of the coach on every first Part 2, so the coach types the counts again.
const prefillable = (c) => Boolean(c.name) && !(c.type === 'TextInput' && c['input-type'] === 'number');

// A pre-filled field's init value, typed as Meta takes it for the component: ticks are a list of
// strings, a tick box a boolean, the rest (text, choices) a string.
function initData(component) {
  if (component.type === 'CheckboxGroup') return { type: 'array', items: { type: 'string' }, __example__: [] };
  if (component.type === 'OptIn') return { type: 'boolean', __example__: false };
  const first = Array.isArray(component['data-source']) && component['data-source'][0];
  return { type: 'string', __example__: first ? first.id : '' };
}

function screen(id, title, children, footerLabel, extraData) {
  const payload = { screen: id };
  if (VERSIONED.has(id)) payload.fv = FORM_VERSION;
  if (PREFILL_FROM.has(id)) payload.prefill = PREFILL;
  for (const f of FIELDS[id]) payload[f] = `\${form.${f}}`;
  // A picker's value may only travel as a top-level string property of a data_exchange (Meta).
  if (id === 'PHOTO_TAKE') payload.photos = '${form.photos}';
  if (id === 'PHOTO_FILES') payload.photo_files = '${form.photo_files}';
  if (id === 'LP_PHOTOS') payload.lp_photos = '${form.lp_photos}';
  if (id === 'LP_FILE') payload.lp_file = '${form.lp_file}';
  const data = { ...(extraData || {}) };
  let init = null;
  if (PREFILL_SCREENS.has(id)) {
    init = {};
    for (const c of children.filter(prefillable)) {
      init[c.name] = `\${data.init_${c.name}}`;
      data[`init_${c.name}`] = initData(c);
    }
  }
  return {
    id,
    title,
    data: { ...data, ...ERR_DATA },
    layout: {
      type: 'SingleColumnLayout',
      children: [{
        type: 'Form',
        name: `${id.toLowerCase()}_form`,
        ...(init ? { 'init-values': init } : {}),
        'error-messages': '${data.error_messages}',
        children: [...children, { type: 'Footer', label: footerLabel, 'on-click-action': { name: 'data_exchange', payload } }],
      }],
    },
  };
}

// "Work on first": the 17 in the order of the four moments with the coaching focus areas beside the ones they
// belong with, then the lesson's structure: the plan's own steps (R14), the warm-up, the closure (R20, R21).
// A line under the choices coaches could not recognise by the title alone.
const FOCUS_LIST = FOCUS_ORDER.map((c) => opt(c, FOCUS[c], FOCUS_DESCRIPTION[c]));
const ALSO_LIST = [opt(ALSO_NONE, 'Nothing else'), ...FOCUS_LIST];

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
    { type: 'TextHeading', text: 'Part 2: independent practice' },
    { type: 'TextCaption', text: '${data.part_hint}' },
    number('p2_spoke', 'Children who spoke', 'Count each child once, including those from Part 1'),
    number('p2_new', 'First time speaking', "Of these, how many hadn't spoken in Part 1?"),
    ...workAloneQuestions(),
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
    { type: 'Dropdown', name: 'priority', label: 'Work on first', required: true, 'data-source': FOCUS_LIST },
    // One "Work on first" drives the brief, the record's focus and the teacher's report; up to two more
    // are for the debrief (FICO pilot sheet R14).
    { type: 'TextCaption', text: 'If the teacher needs more, add up to two. Optional.' },
    { type: 'Dropdown', name: 'also_1', label: 'Also work on', required: false, 'data-source': ALSO_LIST },
    { type: 'Dropdown', name: 'also_2', label: 'And also', required: false, 'data-source': ALSO_LIST },
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
    // Text only (no route or payload change, so FORM_VERSION stays): most coaches record with a
    // WhatsApp voice note, which stops when the camera opens; a recorder app keeps going.
    { type: 'TextBody', text: 'Still recording? The voice recorder app keeps recording when the camera opens, but a WhatsApp voice note pauses: resume it after the photo. Photos you took with the camera during the lesson go in with Upload saved photos.' },
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
        { type: 'Footer', label: 'Continue', 'on-click-action': { name: 'data_exchange', payload: { screen: 'CONTINUE', fv: FORM_VERSION, prefill: PREFILL } } },
      ],
    },
  };
  return {
    version: FLOW_VERSION,
    data_api_version: '3.0',
    routing_model: {
      PART_ONE: ['PART_TWO'],
      PART_TWO: ['LESSON_PLAN'],
      // AFTER too: going back to the plan once the photo step is answered lands on the seal screen again.
      LESSON_PLAN: ['LP_PHOTOS', 'LP_FILE', 'LP_TEXT', 'PHOTOS', 'AFTER'],
      LP_PHOTOS: ['PHOTOS', 'AFTER'],
      LP_FILE: ['PHOTOS', 'AFTER'],
      LP_TEXT: ['PHOTOS', 'AFTER'],
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
        part_hint: { type: 'string', __example__: 'Up to and including guided practice. When the children start independent practice, tap "Part 1 done": your answers are saved then.' },
      }),
      screen('PART_TWO', 'Part 2', part2, 'Part 2 done', {
        part_hint: { type: 'string', __example__: 'Independent practice and the wrap-up, to minute 40. Answer only for this part.' },
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

// The pre-filled fields of each screen, read off the Flow itself so the endpoint and the Flow can never
// disagree: PREFILLED[screen] is the names, PREFILLED_TYPES each one's declared type (what the endpoint
// must send), PREFILLED_ARRAYS the ones whose value is a list of ticks.
function prefilledFields() {
  const out = {};
  const types = {};
  for (const s of buildFieldFormFlow().screens) {
    const form = s.layout.children.find((c) => c.type === 'Form');
    if (!form || !form['init-values']) continue;
    out[s.id] = Object.keys(form['init-values']);
    for (const f of out[s.id]) types[f] = (s.data[`init_${f}`] || {}).type;
  }
  const arrays = new Set(Object.keys(types).filter((f) => types[f] === 'array'));
  return { PREFILLED: out, PREFILLED_TYPES: types, PREFILLED_ARRAYS: arrays };
}
const { PREFILLED, PREFILLED_TYPES, PREFILLED_ARRAYS } = prefilledFields();

module.exports = {
  buildFieldFormFlow, FIELDS, FIELDS_V4, FLOW_VERSION, FORM_VERSION, PREFILL, PREFILLED, PREFILLED_TYPES, PREFILLED_ARRAYS,
  MAX_PHOTOS, MAX_PLAN_PHOTOS, MAX_PLAN_FILES, LP_TEXT_MIN,
};
