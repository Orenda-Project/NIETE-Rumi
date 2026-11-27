'use strict';
/**
 * The caption on the report a coach's visit sends the teacher (observe-send preview; stored on teacher_delivery and
 * shown to the coach before Send, D33).
 *
 * bd-r2uzg1.23.12 (queue #274, call 27A; ICT sheet HITL 44, 45): a teacher got her own DC report and her coach's
 * report for the same lesson and could not tell which was which; the Urdu caption named nobody. The operator,
 * 27 Nov ~07:4x: "when report is received it should be stating it's coming from where". So {fo} is the observer as
 * she knows her: "your coach Ayesha Khan" / "your principal Imran Ali" (آپ کے کوچ … / آپ کے پرنسپل …).
 * FDE and FICO 6-12 visits keep their own captions (bd-pni007, bd-31ziu8).
 */
const { observerLabel } = require('../coaching/report-v2/report-title');

/**
 * @param {object} S             observeStrings(teacher's language)
 * @param {object} analysisData  the session's analysis_data (which rubric the visit was scored on)
 * @param {{name?:string, role?:string}|null} coach  the observer (observe-people coachOf)
 * @param {string} lang          the teacher's language
 */
function teacherReportCaption(S, analysisData, coach, lang) {
  const ownRubric = require('../coaching/frameworks/own-rubric');
  const key = (ownRubric.isFicoSScored(analysisData) && 'report_caption_teacher_ficos')
    || (ownRubric.isObs612Scored(analysisData) && 'report_caption_teacher_obs612');
  const c = coach || {};
  const fo = observerLabel(c.name, c.role, lang) || 'Afisa';
  return ((key && S[key]) || S.report_caption_teacher).replace('{fo}', fo);
}

module.exports = { teacherReportCaption };
