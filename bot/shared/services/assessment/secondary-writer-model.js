/**
 * bd-t8eevw — the writer model for a G6-12 plain paper, and the job it is billed to.
 *
 * G6-8 have their own job (assessment.generate.secondary) so they can move to another model
 * without moving G1-5 or G9-12. With nothing set or written for that job (or the kill switch on)
 * a G6-8 paper is exactly the plain job's answer, under the plain job's name, as before.
 */
const { resolveModelForJob } = require('../../config/model-registry');

const PLAIN_JOB = 'assessment.generate';
const SECONDARY_JOB = 'assessment.generate.secondary';

function writerModel(grade, family, cfg) {
  const plain = () => ({ model: resolveModelForJob(PLAIN_JOB, { cfg, family }).model, job: PLAIN_JOB });
  const g = Number(grade);
  if (!(g >= 6 && g <= 8)) return plain();
  const own = resolveModelForJob(SECONDARY_JOB, { cfg, family });
  if (own.inherited || own.source === 'kill-switch') return plain();
  return { model: own.model, job: SECONDARY_JOB };
}

module.exports = { writerModel, SECONDARY_JOB, PLAIN_JOB };
