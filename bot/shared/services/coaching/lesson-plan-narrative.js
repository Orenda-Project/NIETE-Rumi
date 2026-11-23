'use strict';

/**
 * A structured lesson plan (lesson_plan_structured) as plain lines a model reads, instead of JSON keys. Moved out of
 * GPT5MiniService._formatLessonPlanNarrative (queue #184) so a framework prompt module (fico-s-framework.js) can use it
 * without loading the LLM client and the database; GPT5MiniService still calls it, so its prompts are unchanged.
 * @param {object} lessonPlanStructured
 * @returns {string}
 */
function formatLessonPlanNarrative(lessonPlanStructured) {
  if (!lessonPlanStructured) return '';

  const lines = [];
  const joinList = (items = [], delimiter = '; ') =>
    items.filter(Boolean).join(delimiter);

  if (lessonPlanStructured.subject || lessonPlanStructured.topic) {
    lines.push(
      `Subject & Topic: ${[
        lessonPlanStructured.subject,
        lessonPlanStructured.topic
      ]
        .filter(Boolean)
        .join(' — ')}`
    );
  }

  if (lessonPlanStructured.objectives?.length) {
    lines.push(`Objectives: ${joinList(lessonPlanStructured.objectives)}`);
  }

  if (lessonPlanStructured.prior_knowledge?.length) {
    lines.push(
      `Prior knowledge the teacher expects: ${joinList(
        lessonPlanStructured.prior_knowledge
      )}`
    );
  }

  if (lessonPlanStructured.activities?.length) {
    const activities = lessonPlanStructured.activities
      .map((activity, idx) => {
        const title = activity.title || `Activity ${idx + 1}`;
        const time = activity.time ? ` (${activity.time})` : '';
        return `${title}${time}: ${activity.description || 'No description provided.'}`;
      })
      .join(' | ');
    lines.push(`Planned activities: ${activities}`);
  }

  if (lessonPlanStructured.materials?.length) {
    lines.push(`Materials/resources: ${joinList(lessonPlanStructured.materials)}`);
  }

  if (lessonPlanStructured.resources_detail?.length) {
    const details = lessonPlanStructured.resources_detail
      .map((item) => {
        const reference = item.reference ? ` (Reference: ${item.reference})` : '';
        return `${item.name || 'Resource'}: ${item.description || 'No description'}${reference}`;
      })
      .join(' | ');
    lines.push(`Resource notes: ${details}`);
  }

  if (lessonPlanStructured.textbook_references?.length) {
    const books = lessonPlanStructured.textbook_references
      .map((ref) => `${ref.title || 'Book'} p.${ref.page || 'N/A'} - ${ref.usage || 'Usage not specified'}`)
      .join(' | ');
    lines.push(`Textbook/page references: ${books}`);
  }

  if (lessonPlanStructured.assessment_methods?.length) {
    lines.push(
      `Formative assessment methods: ${joinList(
        lessonPlanStructured.assessment_methods
      )}`
    );
  }

  if (lessonPlanStructured.assessment_sequences?.length) {
    const sequences = lessonPlanStructured.assessment_sequences
      .map((sequence) => {
        const title = sequence.title || 'Assessment';
        const steps = sequence.steps?.length ? ` Steps: ${sequence.steps.join(' › ')}` : '';
        const expected = sequence.expected_responses
          ? ` Expected responses: ${sequence.expected_responses}`
          : '';
        const reference = sequence.reference ? ` (Reference: ${sequence.reference})` : '';
        return `${title}:${steps}${expected}${reference}`;
      })
      .join(' | ');
    lines.push(`Detailed formative tasks: ${sequences}`);
  }

  if (lessonPlanStructured.planned_questions?.length) {
    const questions = lessonPlanStructured.planned_questions
      .map((question) => {
        const q = question.question || 'Question not provided';
        const intent = question.intent ? ` (Purpose: ${question.intent})` : '';
        const expected = question.expected_answer ? ` Expected answer: ${question.expected_answer}` : '';
        return `${q}${intent}${expected}`;
      })
      .join(' | ');
    lines.push(`Planned questions: ${questions}`);
  }

  if (lessonPlanStructured.annexures?.length) {
    const annexures = lessonPlanStructured.annexures
      .map((annex) => `${annex.title || 'Annexure'}: ${annex.purpose || annex.description || 'No description'}`)
      .join(' | ');
    lines.push(`Annexures/printables: ${annexures}`);
  }

  if (!lines.length) {
    lines.push('Lesson plan metadata exists but no structured elements were extracted.');
  }

  return lines.map((line) => `- ${line}`).join('\n');
}

module.exports = { formatLessonPlanNarrative };
