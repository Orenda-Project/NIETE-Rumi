'use strict';
/**
 * The /observe2 field-form rubrics (analysis_data.observe2.rubric). A visit on any of them is a field-form visit:
 * the instrument fico17 in the insights facts, form 'observe2' on the portal, never averaged with the FICO V3 form.
 * fico17 is v5; fico17_v6 is stamped at visit creation when the region's coach switch selects v6 (FICO6, RULINGS R16).
 * Exact strings only: anything else on observe2.rubric is not a field form.
 */
const FIELD_FORM_RUBRICS = Object.freeze(['fico17', 'fico17_v6']);

const isFieldFormRubric = (rubric) => FIELD_FORM_RUBRICS.includes(rubric);

module.exports = { FIELD_FORM_RUBRICS, isFieldFormRubric };
