'use strict';

/**
 * Child test check Flow — the coach confirms or corrects the AI's marks for one child.
 *
 *   URDU     the story count (or, for a child who could not read the story, letters and words),
 *            the words heard wrong as pre-ticked chips, each question with the child's answer,
 *            first sounds (the model's hint shown), made-up words
 *   ENGLISH  the same, without first sounds
 *   MATHS    numbers read aloud, the quick-sum count, the written sums read from the photo, the word
 *            problem
 *   DONE
 *
 * About a minute: what the model is sure of arrives filled in; what it is not sure of arrives empty
 * and is required (prefill.js holds that rule). A Flow cannot play audio; the coach re-listens to
 * the voice note in the chat.
 *
 * Every label is ${data.*} from the catalog (strings.js), so the coach reads it in their language;
 * the screen titles are the only fixed text, in both. Every footer is a data_exchange that posts every
 * field on its screen, so each block is saved as soon as its screen is submitted.
 * Token: <coachUserId>:child-test-check:<sessionId>.
 *
 * Regenerate the committed copy after any change:  node bot/scripts/generate-child-test-check-flow-json.js
 */

const SLOTS = require('./slots');
const { renderScreen, MAX_CHIPS, PREFIX } = require('./prefill');
const { checkStrings } = require('./strings');
const EXAMPLE = require('./example');

const FLOW_VERSION = '7.3';
const SCREEN_IDS = ['URDU', 'ENGLISH', 'MATHS', 'DONE'];
const TITLES = { URDU: 'اردو · Urdu', ENGLISH: 'انگریزی · English', MATHS: 'حساب · Maths', DONE: 'محفوظ · Saved' };

const d = (k) => `\${data.${k}}`;
const OPTION_LIST = { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } } } };

function declare(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    let type;
    if (typeof v === 'boolean') type = { type: 'boolean' };
    else if (Array.isArray(v)) type = v.length && typeof v[0] === 'object' ? OPTION_LIST : { type: 'array', items: { type: 'string' } };
    else if (v && typeof v === 'object') type = { type: 'object' };
    else type = { type: 'string' };
    out[k] = { ...type, __example__: v };
  }
  return out;
}

function screenWith(id, children, data, initValues) {
  const fields = [];
  const collect = (list) => list.forEach((c) => {
    if (c.name) fields.push(c.name);
    ['then', 'else'].forEach((k) => Array.isArray(c[k]) && collect(c[k]));
  });
  collect(children);
  const payload = { screen: id };
  for (const f of fields) payload[f] = `\${form.${f}}`;
  return {
    id,
    title: TITLES[id],
    data: declare(data),
    layout: {
      type: 'SingleColumnLayout',
      children: [{
        type: 'Form',
        name: `${id.toLowerCase()}_form`,
        'init-values': initValues,
        'error-messages': '${data.error_messages}',
        children: [...children, { type: 'Footer', label: d('t_next'), 'on-click-action': { name: 'data_exchange', payload } }],
      }],
    },
  };
}

const number = (name, label, helper, visible) => ({
  type: 'TextInput', name, label: d(label), 'input-type': 'number', required: true, ...(helper ? { 'helper-text': d(helper) } : {}), ...(visible ? { visible: d(visible) } : {}),
});
const radio = (name, key, source) => ({
  type: 'RadioButtonsGroup', name, label: d(`${key}_t`), description: d(`${key}_d`), required: true, visible: d(`${key}_v`), 'data-source': d(source),
});
const chips = (name, label, key) => ({
  type: 'ChipsSelector', name, label: d(label), 'data-source': d(`${key}_opts`), 'max-selected-items': MAX_CHIPS, required: false, visible: d(`${key}_v`),
});

function readingScreen(block) {
  const id = block.toUpperCase();
  const p = PREFIX[block];
  const s = SLOTS[block];
  const init = { [`${p}wc`]: d('wc_i'), [`${p}wa`]: d('wa_i'), [`${p}flag`]: d('flag_on'), [`${p}sw`]: d('sw_i'), [`${p}fl`]: d('fl_i'), [`${p}fw`]: d('fw_i') };
  const kids = [
    { type: 'TextHeading', text: d('child_line') },
    { type: 'TextBody', text: d('status_line') },
    { type: 'TextSubheading', text: d('t_story'), visible: d('story_v') },
    number(`${p}wc`, 't_wc', 'wc_h', 'story_v'),
    number(`${p}wa`, 't_wa', null, 'story_v'),
    { type: 'TextCaption', text: d('flag_cap'), visible: d('flag_v') },
    chips(`${p}flag`, 't_flag', 'flag'),
    { type: 'RadioButtonsGroup', name: `${p}sw`, label: d('sw_t'), required: true, visible: d('sw_v'), 'data-source': d('readwrong') },
    { type: 'TextSubheading', text: d('t_fb'), visible: d('fb_v') },
    number(`${p}fl`, 't_fl', 'fl_h', 'fb_v'),
    number(`${p}fw`, 't_fw', 'fw_h', 'fb_v'),
    { type: 'TextSubheading', text: d('t_q'), visible: d('sec_v') },
  ];
  for (let i = 1; i <= s.q; i += 1) { kids.push(radio(`${p}q${i}`, `q${i}`, 'verdicts')); init[`${p}q${i}`] = d(`q${i}_i`); }
  if (s.fs) {
    kids.push({ type: 'TextSubheading', text: d('t_fs'), visible: d('fs_sec_v') });
    for (let i = 1; i <= s.fs; i += 1) { kids.push(radio(`${p}fs${i}`, `fs${i}`, 'verdicts')); init[`${p}fs${i}`] = d(`fs${i}_i`); }
  }
  kids.push(
    { type: 'TextSubheading', text: d('t_nw'), visible: d('sec_v') },
    { type: 'TextCaption', text: d('nwc_cap'), visible: d('nwc_v') },
    chips(`${p}nwc`, 't_nwc', 'nwc'),
  );
  init[`${p}nwc`] = d('nwc_on');
  for (let i = 1; i <= s.nw; i += 1) { kids.push(radio(`${p}nw${i}`, `nw${i}`, 'verdicts')); init[`${p}nw${i}`] = d(`nw${i}_i`); }
  const example = renderScreen(block, { aiMarks: EXAMPLE.MARKS[block], items: EXAMPLE.ITEMS, lang: 'ur', child: EXAMPLE.CHILD, aiStatus: 'scored' }).data;
  return screenWith(id, kids, example, init);
}

function mathsScreen() {
  const p = PREFIX.maths;
  const s = SLOTS.maths;
  const init = { [`${p}numc`]: d('numc_on'), [`${p}qc`]: d('qc_i'), [`${p}qa`]: d('qa_i'), [`${p}wp`]: d('wp_i') };
  const kids = [
    { type: 'TextHeading', text: d('child_line') },
    { type: 'TextBody', text: d('status_line') },
    { type: 'TextSubheading', text: d('t_num'), visible: d('sec_v') },
    { type: 'TextCaption', text: d('numc_cap'), visible: d('numc_v') },
    chips(`${p}numc`, 't_numc', 'numc'),
  ];
  for (let i = 1; i <= s.n; i += 1) { kids.push(radio(`${p}n${i}`, `n${i}`, 'verdicts')); init[`${p}n${i}`] = d(`n${i}_i`); }
  kids.push(
    { type: 'TextSubheading', text: d('t_qs'), visible: d('sec_v') },
    number(`${p}qc`, 't_qc', 'qc_h'),
    number(`${p}qa`, 't_qa', null),
    { type: 'TextSubheading', text: d('t_wr'), visible: d('sec_v') },
  );
  for (let i = 1; i <= s.w; i += 1) { kids.push(radio(`${p}w${i}`, `w${i}`, 'wverdicts')); init[`${p}w${i}`] = d(`w${i}_i`); }
  kids.push(
    { type: 'TextSubheading', text: d('t_wp'), visible: d('wp_v') },
    radio(`${p}wp`, 'wp', 'verdicts'),
  );
  const example = renderScreen('maths', { aiMarks: EXAMPLE.MARKS.maths, items: EXAMPLE.ITEMS, lang: 'ur', child: EXAMPLE.CHILD, aiStatus: 'scored' }).data;
  return screenWith('MATHS', kids, example, init);
}

function doneData(lang = 'ur') {
  const S = checkStrings(lang);
  return { done_line: S.done_saved, next_line: S.done_next(S.roll(14)), done_button: S.done_button, session_id: '00000000-0000-4000-8000-000000000000' };
}

function doneScreen() {
  return {
    id: 'DONE',
    title: TITLES.DONE,
    terminal: true,
    success: true,
    // Flat keys in the complete payload: Meta drops extension_message_response (flow-type-detector.js).
    data: declare(doneData()),
    layout: {
      type: 'SingleColumnLayout',
      children: [
        { type: 'TextHeading', text: d('done_line') },
        { type: 'TextBody', text: d('next_line') },
        { type: 'Footer', label: d('done_button'), 'on-click-action': { name: 'complete', payload: { child_test: 'checked', session_id: d('session_id') } } },
      ],
    },
  };
}

function buildChildTestCheckFlow() {
  const screens = [readingScreen('urdu'), readingScreen('english'), mathsScreen(), doneScreen()];
  const routing = {};
  screens.forEach((sc, i) => { routing[sc.id] = i < screens.length - 1 ? [screens[i + 1].id] : []; });
  return { version: FLOW_VERSION, data_api_version: '3.0', routing_model: routing, screens };
}

module.exports = { buildChildTestCheckFlow, SCREEN_IDS, SLOTS, FLOW_VERSION, TITLES };
