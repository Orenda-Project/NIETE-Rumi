/**
 * The assessment survey's two receivers. An emitted button prefix with no dispatcher, or a window
 * with no consumer, loses the teacher's answer with no error anywhere — the orphan class the
 * pre-merge checklist opens with. The behaviour behind each line is executed in
 * assessment-feedback.test.js; these pin that the lines are wired, as tests/lp612/feedback.test.js
 * does for its sibling.
 */
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

test('whatsapp-bot.js dispatches asmt_fb_ to the assessment feedback service', () => {
  const src = read('bot/whatsapp-bot.js');
  const at = src.indexOf("buttonId.startsWith('asmt_fb_')");
  expect(at).toBeGreaterThan(-1);
  expect(src.slice(at, at + 400)).toMatch(/assessment-feedback\.service[\s\S]*handleAssessmentFeedbackButton\(buttonId, from\)/);
});

test('text-message.handler consumes the improve answer before routing, and holds typing for it', () => {
  const src = read('bot/shared/handlers/text-message.handler.js');
  expect(src).toMatch(/AssessmentFeedbackService\.consumeReasonIfPending\(user\.id, from, messageBody/);
  expect(src).toMatch(/AssessmentFeedbackService\.REDIS_REASON_KEY\(user\.id\)/);
});

// A column only in a migration is invisible to `npm run bootstrap:db`, and a fresh clone then runs
// code that writes a column its database does not have.
test('assessment_paper_id exists in BOTH the migration and the bootstrap schema', () => {
  const add = /ALTER TABLE lp_feedback ADD COLUMN IF NOT EXISTS assessment_paper_id UUID REFERENCES assessment_papers\(id\)/;
  expect(read('infrastructure/supabase/migrations/V1.9.4__assessment_teacher_feedback.sql')).toMatch(add);
  expect(read('infrastructure/supabase/00_complete-schema.sql')).toMatch(add);
});
