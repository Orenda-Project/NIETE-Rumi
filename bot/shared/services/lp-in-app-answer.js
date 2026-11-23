'use strict';
/**
 * Has she answered this grades 1-5 lesson in the teacher app? The WhatsApp survey tap (lp-feedback.service) asks this
 * so an app answer is not answered a second time on WhatsApp. The app writes its answer on its own lesson_plans row
 * (surface 'app'), so the lookup goes by the lesson id on any of her rows. Depends on the database client only, so the
 * tap and the in-app writer (lp-in-app-feedback.service) never require each other.
 */
const supabase = require('../config/supabase');

function must({ data, error }) {
  if (error) throw new Error(error.message || 'lp_feedback read failed');
  return data || [];
}

/** Her in_app answer { id, useful } for this lesson, or null. Throws when the database cannot answer. */
async function answeredInApp(userId, lessonId) {
  if (!userId || !lessonId) return null;
  const plans = must(await supabase.from('lesson_plans').select('id')
    .eq('user_id', userId).eq('content->v8->>lesson_id', lessonId));
  if (!plans.length) return null;
  const rows = must(await supabase.from('lp_feedback').select('id, useful')
    .eq('user_id', userId).eq('trigger_mode', 'in_app').in('lesson_plan_id', plans.map((p) => p.id)).limit(1));
  return rows[0] || null;
}

module.exports = { answeredInApp };
