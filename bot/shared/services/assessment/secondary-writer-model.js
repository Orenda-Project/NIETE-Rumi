/**
 * bd-t8eevw — which model writes a plain paper. G6-8 may run on their own job,
 * assessment.generate.secondary (Haiku passed the round-4 eval there, bd-rzjnjp); every other grade,
 * and G6-8 whenever that job only inherits or the kill switch is on, stays on assessment.generate.
 * Pure: the caller resolves both jobs (with the settings row) and passes the two resolutions in, so
 * the settingsAtSite guard sees the literal call in free-secondary.service.js.
 */
const PLAIN_JOB = 'assessment.generate';
const SECONDARY_JOB = 'assessment.generate.secondary';

function writerModel(grade, plain, secondary) {
  const g = Number(grade);
  const own = g >= 6 && g <= 8 && secondary && !secondary.inherited && secondary.source !== 'kill-switch';
  return own ? { model: secondary.model, job: SECONDARY_JOB } : { model: plain.model, job: PLAIN_JOB };
}

module.exports = { writerModel, SECONDARY_JOB, PLAIN_JOB };
