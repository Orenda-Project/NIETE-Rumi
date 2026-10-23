/**
 * v10 coaching test (bd-v0toag.50.1): the v10 card for plan-arm v10 schools (B, D).
 *
 * The card is its own asset kind ('card', niete_lp_assets) beside the v9 lesson, so the v9 row
 * stays current for everyone else. A teacher whose school's plan arm is v10 gets the current card;
 * anyone else, a day with no card, the switch off (groupFor is null) or any failure gets the v9
 * lesson. The card never stands alone: no v9 lesson, nothing. The v9 lesson stays the plan of record
 * (the caller records the download against it, so grading and the quiz key off it); every send to a
 * drawn teacher is logged as lp.v10.plan_served so a card send is told apart from a v9 send.
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { logEvent } = require('../utils/structured-logger');
const { groupFor } = require('./coaching/ab-v10-arms');

const EVENT = 'lp.v10.plan_served';

/** { asset, served } for a plan arm, the v9 lesson and the card. Pure. */
function pickServed({ plan, lesson, card }) {
  if (lesson && plan === 'v10' && card && card.r2_key) return { asset: card, served: 'card' };
  return { asset: lesson || null, served: 'v9' };
}

async function currentCard(lessonId) {
  const { data, error } = await supabase
    .from('niete_lp_assets')
    .select('id, lesson_id, asset_kind, r2_key, content_hash, version_stamp, is_current')
    .eq('lesson_id', lessonId)
    .eq('asset_kind', 'card')
    .eq('is_current', true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

/**
 * The asset to send for this teacher: the card for plan arm v10, else `lesson`. Never throws.
 *
 * bd-4joiqz — `reader: 'leader'`: a coach, principal, AEO… READING the plan in the portal. They get exactly what a
 * teacher of their school gets (the card in a plan-arm school), but it is not logged as lp.v10.plan_served: that event
 * counts plans served to the test's teachers, and a leader's read is not one.
 */
async function servedFor({ userId, lessonId, lesson, channel, reader = null }) {
  if (!lesson) return null;
  try {
    const arms = await groupFor(userId);
    if (!arms) return lesson;
    const card = arms.plan === 'v10' ? await currentCard(lessonId) : null;
    const { asset, served } = pickServed({ plan: arms.plan, lesson, card });
    if (reader !== 'leader') {
      logEvent(EVENT, {
        userId, lessonId, channel, group: arms.group, plan: arms.plan, served,
        cardAssetId: card ? card.id : null, lessonAssetId: lesson.id || null,
      });
    }
    return asset;
  } catch (err) {
    logToFile('v10 test: card lookup failed — v9 plan sent', { userId, lessonId, error: err.message });
    return lesson;
  }
}

module.exports = { EVENT, pickServed, servedFor };
