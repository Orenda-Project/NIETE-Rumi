'use strict';
/**
 * bd-8sr958 — the AAC-LC configs an Android recorder writes, in the order tried. 44.1 and 48 kHz decode the same
 * (a wrong pick plays ~9% off-speed, which transcription survives), so the order is the survey's count, and the
 * pick is logged as `template_guess`. Source: logs/damage_survey.tsv in the pk-ict/infra/bd-8sr958 work folder.
 */
const TEMPLATE_ORDER = [
  { name: '48000/stereo', asc: '1190' },
  { name: '44100/stereo', asc: '1210' },
  { name: '48000/mono', asc: '1188' },
  { name: '44100/mono', asc: '1208' },
];
module.exports = { TEMPLATE_ORDER };
