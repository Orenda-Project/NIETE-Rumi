'use strict';
/**
 * bd-kijmb8 (queue #318) — GET /api/portal/coaching-session/:id/lesson-plan/file
 *
 * The lesson plan linked to a recording, served from the portal's own origin so the viewer can read it from the page.
 *
 * ACCESS is the same as the page it opens from: the teacher who owns the session (a coach's observation only once it has
 * been sent to her, as her report page decides), or the coach / principal who observed it. Anyone else gets the same 404 as
 * a session that does not exist. Behind `portal_lesson_plan_open`, fail-closed (off = 404, nothing read).
 *
 * WHICH FILE. A library link (`_fidelity_ref`) serves the exact version she taught from, so the coach reads what was
 * taught; if that version has been removed, the current asset. Otherwise the session's own file with its own content type.
 * `?link=1` answers the signed link as JSON instead (the viewer's "Open in another app").
 *
 * Logs session ids only: never a key, a link, a name or a phone number.
 */
const { planRef, contentTypeOf } = require('../../bot/shared/services/coaching/session-lesson-plan');
const TeacherObservation = require('./teacher-observation');

const OPEN_KEY = 'portal_lesson_plan_open';
const SESSION_COLUMNS = 'id, user_id, observer_user_id, observation_type, has_lesson_plan, lesson_plan_r2_key, lesson_plan_format, lesson_plan_structured, analysis_data';

/** 'teacher' | 'observer' | null — who this user is to this session. */
function relationTo(session, userId) {
  if (!session || !userId) return null;
  if (session.user_id === userId && TeacherObservation.teacherMaySee(session)) return 'teacher';
  if (session.observation_type === TeacherObservation.OBSERVATION_TYPE && session.observer_user_id === userId) return 'observer';
  return null;
}

async function libraryKey(supabase, ref) {
  const q = (extra) => {
    let query = supabase.from('niete_lp_assets').select('r2_key, version_stamp, is_current')
      .eq('lesson_id', ref.lesson_id).eq('asset_kind', 'lesson');
    for (const [k, v] of Object.entries(extra)) query = query.eq(k, v);
    return query.order('created_at', { ascending: false }).limit(1);
  };
  if (ref.version_stamp) {
    const { data } = await q({ version_stamp: ref.version_stamp });
    if (data && data[0] && data[0].r2_key) return data[0].r2_key;
  }
  const { data } = await q({ is_current: true });
  return data && data[0] && data[0].r2_key ? data[0].r2_key : null;
}

function createLessonPlanFileHandler({ supabase, isOn, resolveUrl, relay, log = () => {} }) {
  const notFound = (res, extra) => res.status(404).json({ success: false, error: 'Not found', ...(extra || {}) });
  return async function lessonPlanFile(req, res) {
    const userId = req.session && req.session.portalUserId;
    const sessionId = String(req.params.id || '').trim();
    try {
      if (!userId || !sessionId || !(await isOn(userId))) return notFound(res);
      const { data: session } = await supabase.from('coaching_sessions').select(SESSION_COLUMNS).eq('id', sessionId).maybeSingle();
      if (!relationTo(session, userId)) return notFound(res);
      const plan = planRef(session);
      if (!plan.openable) return notFound(res);
      const key = plan.ref ? await libraryKey(supabase, plan.ref) : plan.key;
      if (!key) return notFound(res, { available: false });
      const url = await resolveUrl(key);
      if (!url) return notFound(res, { available: false });
      if (req.query && (req.query.link === '1' || req.query.link === 'true')) {
        return res.json({ success: true, available: true, url });
      }
      return await relay(url, res, { contentType: contentTypeOf(plan.fileKind, key) });
    } catch (error) {
      log('lesson plan file failed', { sessionId, userId, error: error && error.message });
      if (!res.headersSent) res.status(502).json({ success: false, error: 'Could not open this lesson plan' });
      return undefined;
    }
  };
}

module.exports = { createLessonPlanFileHandler, relationTo, OPEN_KEY };
