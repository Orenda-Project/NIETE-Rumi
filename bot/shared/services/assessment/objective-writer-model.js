/**
 * bd-rzjnjp.6 — which model writes a G1-5 plain paper, and the job it is billed to.
 *
 * Round-8 eval (bd-rzjnjp): Flash matched Pro on objective-only papers (+0.7) and on maths papers
 * (+0.4) but not on topic papers (−1.8), so only the passing types get their own job. Unset, or
 * with the kill switch on, the objective job inherits and every paper stays on assessment.generate.
 */
const PLAIN_JOB = 'assessment.generate';
const OBJECTIVE_JOB = 'assessment.generate.objective';

const isObjective = (t) => t && (t.category === 'objective' || t.id === 'mcq');

function objectiveWriter({ grade, subjectKey, slos, questionTypes } = {}, plain, objective) {
  const g = Number(grade);
  const types = Array.isArray(questionTypes) ? questionTypes : [];
  const passes = g >= 1 && g <= 5
    && !(Array.isArray(slos) && slos.length)
    && ((types.length > 0 && types.every(isObjective)) || subjectKey === 'maths');
  const own = passes && objective && !objective.inherited && objective.source !== 'kill-switch';
  return own ? { model: objective.model, job: OBJECTIVE_JOB } : { model: plain.model, job: PLAIN_JOB };
}

module.exports = { objectiveWriter, OBJECTIVE_JOB, PLAIN_JOB };
