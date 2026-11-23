'use strict';
/**
 * A stand-in for bot/shared/services/lp-whatsapp-off.js that keeps its rules (the real shared parser decides what a
 * value means) but takes the settings and who is a GB teacher from `state`, so a test can walk the whole matrix:
 *
 *   jest.mock('../../bot/shared/services/lp-whatsapp-off', () => require('../fixtures/lp-whatsapp-off-fake').module);
 *
 * The real reader (cache, failed reads, programme lookup) is pinned by tests/feedback/lp-whatsapp-off.test.js.
 */
const {
  LP_WHATSAPP_PDF_OFF_KEY, LP_WHATSAPP_SURVEY_OFF_KEY, parseProgrammeList,
} = require('../../bot/shared/config/lp-whatsapp-programmes');

const ICT_TEACHER = '0b6a1f2e-1111-4111-8111-000000000001';
const GB_TEACHER = '0b6a1f2e-2222-4222-8222-000000000002';

const state = { settings: {}, gb: new Set([GB_TEACHER]), calls: [] };

function reset() {
  state.settings = {};
  state.gb = new Set([GB_TEACHER]);
  state.calls = [];
}

const offFor = (key) => async (userId) => {
  state.calls.push({ key, userId });
  if (typeof userId !== 'string' || !userId) return false;
  const list = Object.prototype.hasOwnProperty.call(state.settings, key) ? parseProgrammeList(state.settings[key]) : [];
  if (!list.length) return false;
  return list.includes(state.gb.has(userId) ? 'gb' : 'ict');
};

/**
 * The matrix every site is tested on: [label, stored value (undefined = no row), is it off for ICT, is it off for GB].
 * A malformed value means today, exactly like no row.
 */
const MATRIX = [
  ['no row', undefined, false, false],
  ['["ict"]', ['ict'], true, false],
  ['["gb"]', ['gb'], false, true],
  ['["ict","gb"]', ['ict', 'gb'], true, true],
  ['malformed: true', true, false, false],
  ['malformed: an unknown programme', ['ict', 'punjab'], false, false],
  ['malformed: bad JSON', '["ict"', false, false],
];

/** Each row of MATRIX, once per teacher: [label, value, teacher name, userId, expected off]. */
const PER_TEACHER = MATRIX.flatMap(([label, value, ict, gb]) => [
  [label, value, 'ICT', ICT_TEACHER, ict],
  [label, value, 'GB', GB_TEACHER, gb],
]);

function set(key, value) {
  if (value === undefined) delete state.settings[key];
  else state.settings[key] = value;
}

module.exports = {
  ICT_TEACHER,
  GB_TEACHER,
  MATRIX,
  PER_TEACHER,
  state,
  reset,
  set,
  setPdfOff: (value) => set(LP_WHATSAPP_PDF_OFF_KEY, value),
  setSurveyOff: (value) => set(LP_WHATSAPP_SURVEY_OFF_KEY, value),
  module: {
    LP_WHATSAPP_PDF_OFF_KEY,
    LP_WHATSAPP_SURVEY_OFF_KEY,
    isLpWhatsappPdfOffFor: offFor(LP_WHATSAPP_PDF_OFF_KEY),
    isLpWhatsappSurveyOffFor: offFor(LP_WHATSAPP_SURVEY_OFF_KEY),
  },
};
