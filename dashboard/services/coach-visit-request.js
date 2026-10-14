'use strict';
/**
 * "If you disagree and want a person to observe instead" on group C and D's report page — v10 coaching
 * test, bd-v0toag.45.
 *
 * coachesFor: the coaches of the teacher's school (leader_schools x users.school_id; leader_teachers is
 * deprecated), by name only — a coach's phone never reaches the page.
 * requestVisit: she picked one of them, or "none of these" (coachId null). ONE coach_visit_requests row per
 * report (UNIQUE session), written before the ping, so a second tap never pings twice. The coach gets the
 * approved template coach_visit_request_v1 in their own language; the row then reads sent or failed.
 *
 * Returns { status }: sent | failed | already | no_coach | invalid. Never throws.
 */
const { TEMPLATE } = require('../../bot/shared/templates/coach-visit-request.template');
const { templateCodeFor } = require('../../bot/shared/config/languages');
const { firstNameOf, fullNameOf } = require('../../bot/shared/utils/person-name');

const GRAPH = 'https://graph.facebook.com/v21.0';
const GROUPS = new Set(['C', 'D']);

/** The approved template to one coach, from the portal's own WhatsApp number. */
async function sendTemplate({ to, language, params }) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.PHONE_NUMBER_ID;
  if (!token || !phoneId) return { ok: false };
  const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: TEMPLATE.name,
        language: { code: language },
        components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: String(text) })) }],
      },
    }),
  });
  const d = await r.json().catch(() => ({}));
  const messageId = d && d.messages && d.messages[0] && d.messages[0].id;
  return r.ok && messageId ? { ok: true, messageId } : { ok: false };
}

async function schoolOf(supabase, userId) {
  const { data } = await supabase.from('users').select('name, school_id').eq('id', userId).maybeSingle();
  return data || null;
}

async function linksOf(supabase, schoolId) {
  if (!schoolId) return [];
  const { data } = await supabase.from('leader_schools').select('leader_user_id, school_name').eq('school_id', schoolId);
  return data || [];
}

/** Her school's coaches as [{ id, name }], one each. Never throws: an error is no coaches. */
async function coachesFor(supabase, userId) {
  try {
    const teacher = await schoolOf(supabase, userId);
    const ids = [...new Set((await linksOf(supabase, teacher && teacher.school_id)).map((l) => l.leader_user_id).filter(Boolean))];
    if (!ids.length) return [];
    const { data } = await supabase.from('users').select('id, name').in('id', ids);
    return (data || []).map((u) => ({ id: u.id, name: fullNameOf(u) || u.name || '' })).filter((c) => c.name);
  } catch (_) {
    return [];
  }
}

async function requestVisit(supabase, { sessionId, userId, group, coachId }, { send = sendTemplate } = {}) {
  try {
    if (!GROUPS.has(group)) return { status: 'invalid' };
    const { data: own } = await supabase.from('coaching_sessions').select('id')
      .eq('id', sessionId).eq('user_id', userId).maybeSingle();
    if (!own) return { status: 'invalid' };
    const teacher = (await schoolOf(supabase, userId)) || {};
    const row = {
      coaching_session_id: sessionId, teacher_user_id: userId, school_id: teacher.school_id || null, ab_group: group,
    };
    const insert = async (extra) => {
      const { error } = await supabase.from('coach_visit_requests').insert({ ...row, ...extra });
      if (!error) return null;
      return error.code === '23505' ? 'already' : 'failed';
    };

    if (!coachId) return { status: (await insert({ coach_user_id: null, status: 'no_coach' })) || 'no_coach' };

    const link = (await linksOf(supabase, teacher.school_id)).find((l) => l.leader_user_id === coachId);
    if (!link) return { status: 'invalid' };
    const { data: coach } = await supabase.from('users').select('id, name, phone_number, preferred_language')
      .eq('id', coachId).maybeSingle();
    if (!coach) return { status: 'invalid' };

    const refused = await insert({ coach_user_id: coachId, status: 'pending' });
    if (refused) return { status: refused };

    let sent = { ok: false };
    if (coach.phone_number) {
      try {
        sent = await send({
          to: coach.phone_number,
          language: templateCodeFor(coach.preferred_language) || templateCodeFor('en'),
          // Meta refuses an empty parameter, so a missing name is never sent blank.
          params: [firstNameOf(coach) || 'Coach', fullNameOf(teacher) || 'A teacher', link.school_name || 'their school'],
        });
      } catch (_) { sent = { ok: false }; }
    }
    const status = sent && sent.ok ? 'sent' : 'failed';
    await supabase.from('coach_visit_requests')
      .update({ status, wa_message_id: (sent && sent.messageId) || null, updated_at: new Date().toISOString() })
      .eq('coaching_session_id', sessionId);
    return { status };
  } catch (_) {
    return { status: 'failed' };
  }
}

module.exports = { coachesFor, requestVisit, sendTemplate };
