'use strict';
/**
 * The C/D coach ping — v10 coaching test. bd-v0toag.45 built a one-tap "ask my coach"; bd-v0toag.38.9
 * replaced it with "Do you agree with this report?": a teacher who does not agree ticks why, may record a
 * voice note, and her coach is pinged with her score, her reasons and a link to the coach card.
 *
 * coachesFor: the coaches of the teacher's school (leader_schools x users.school_id; leader_teachers is
 * deprecated), by name only — a coach's phone never reaches the page.
 * requestVisit: her school's coach is picked for her when there is one; with more she picks. ONE
 * coach_visit_requests row per report (UNIQUE session), written before the ping, so a second send never
 * pings twice. Her note goes to R2 under the request id. The coach gets coach_visit_request_v2 in their own
 * language, or the approved v1 while v2 waits for Meta; the row then reads sent or failed.
 * Returns { status }: sent | failed | already | no_coach | invalid. Never throws.
 * loadCard / markVisited: what the coach card shows, and "I have visited" (the note is deleted then).
 */
const { TEMPLATE, TEMPLATE_V2 } = require('../../bot/shared/templates/coach-visit-request.template');
const { templateCodeFor } = require('../../bot/shared/config/languages');
const { firstNameOf, fullNameOf } = require('../../bot/shared/utils/person-name');
const { cleanReasons, reasonText } = require('./coach-ping-reasons');
const { coachCardUrl } = require('./coach-card-token');

const GRAPH = 'https://graph.facebook.com/v21.0';
const GROUPS = new Set(['C', 'D']);

/** The approved template to one coach, from the portal's own WhatsApp number. */
async function sendTemplate({ to, language, template = TEMPLATE.name, params }) {
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
        name: template,
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

const NOTE_PREFIX = 'coach-visit-notes';
const EXT = { mp4: 'm4a', 'x-m4a': 'm4a', mpeg: 'mp3' };
const { noteStore } = require('./coach-note-store');
const noteKey = (requestId, type) => {
  const sub = String(type || '').split('/')[1] || 'bin';
  const ext = (EXT[sub.split(';')[0]] || sub.split(';')[0]).replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  return `${NOTE_PREFIX}/${requestId}.${ext}`;
};
const pctOf = (session) => {
  const p = session && session.analysis_data && session.analysis_data.scores && session.analysis_data.scores.overall_percentage;
  return p == null || p === '' || !Number.isFinite(Number(p)) ? 'no score' : `${Math.round(Number(p))}%`;
};

/** Try v2 (score, reasons, card link); if it is refused or cannot be built, the approved v1. */
async function ping(send, coach, base, extra) {
  const tryOne = async (m) => { try { return (await send(m)) || { ok: false }; } catch (_) { return { ok: false }; } };
  const language = templateCodeFor(coach.preferred_language) || templateCodeFor('en');
  if (extra.link) {
    const v2 = await tryOne({ to: coach.phone_number, language, template: TEMPLATE_V2.name, params: [...base, extra.pct, extra.reasons, extra.link] });
    if (v2.ok) return v2;
  }
  return tryOne({ to: coach.phone_number, language, template: TEMPLATE.name, params: base });
}

async function requestVisit(supabase, { sessionId, userId, group, coachId, reasons, note }, deps = {}) {
  const send = deps.send || sendTemplate;
  const put = deps.put || ((buf, key, type) => noteStore().put(buf, key, type));
  try {
    if (!GROUPS.has(group)) return { status: 'invalid' };
    const { data: own } = await supabase.from('coaching_sessions').select('id, analysis_data')
      .eq('id', sessionId).eq('user_id', userId).maybeSingle();
    if (!own) return { status: 'invalid' };
    const teacher = (await schoolOf(supabase, userId)) || {};
    const codes = cleanReasons(reasons);
    const row = {
      coaching_session_id: sessionId, teacher_user_id: userId, school_id: teacher.school_id || null, ab_group: group, reasons: codes,
    };
    const insert = async (extra) => {
      const { data, error } = await supabase.from('coach_visit_requests').insert({ ...row, ...extra }).select('id').single();
      if (!error) return { id: data && data.id };
      return { refused: error.code === '23505' ? 'already' : 'failed' };
    };

    const links = await linksOf(supabase, teacher.school_id);
    const ids = [...new Set(links.map((l) => l.leader_user_id).filter(Boolean))];
    if (!ids.length) {
      const r = await insert({ coach_user_id: null, status: 'no_coach' });
      return { status: r.refused || 'no_coach' };
    }
    const pick = coachId || (ids.length === 1 ? ids[0] : null);
    const link = pick && links.find((l) => l.leader_user_id === pick);
    if (!link) return { status: 'invalid' };
    const { data: coach } = await supabase.from('users').select('id, name, phone_number, preferred_language')
      .eq('id', pick).maybeSingle();
    if (!coach) return { status: 'invalid' };

    const made = await insert({ coach_user_id: pick, status: 'pending' });
    if (made.refused) return { status: made.refused };
    const requestId = made.id;
    const update = (patch) => supabase.from('coach_visit_requests').update(patch).eq('id', requestId);

    if (note && Buffer.isBuffer(note.buffer) && note.buffer.length) {
      // A note that fails to upload never stops the ping: her reasons still reach the coach.
      try {
        const key = noteKey(requestId, note.type);
        await put(note.buffer, key, note.type);
        await update({ voice_note_key: key });
      } catch (_) { /* the request stands without the note */ }
    }

    let sent = { ok: false };
    if (coach.phone_number) {
      // Meta refuses an empty parameter, so a missing name is never sent blank.
      const base = [firstNameOf(coach) || 'Coach', fullNameOf(teacher) || 'A teacher', link.school_name || 'their school'];
      const coachLang = coach.preferred_language === 'ur' ? 'ur' : 'en';
      sent = await ping(send, coach, base, { pct: pctOf(own), reasons: reasonText(codes, coachLang), link: coachCardUrl(requestId) });
    }
    const status = sent.ok ? 'sent' : 'failed';
    await update({ status, wa_message_id: sent.messageId || null, updated_at: new Date().toISOString() });
    return { status };
  } catch (_) {
    return { status: 'failed' };
  }
}

const CARD_SELECT = 'id, coaching_session_id, teacher_user_id, coach_user_id, school_id, status, reasons, voice_note_key';

/**
 * What the coach card shows: { teacher, school, language (the coach's), status, reasons, noteUrl, view }, or
 * null. deps.loadReport(supabase, sessionId, userId) gives the report data; the note link lasts an hour.
 */
async function loadCard(supabase, requestId, deps = {}) {
  const presign = deps.presign || ((key, s) => noteStore().presign(key, s));
  const { data: row } = await supabase.from('coach_visit_requests').select(CARD_SELECT).eq('id', requestId).maybeSingle();
  if (!row) return null;
  const [teacher, coach, school, data] = await Promise.all([
    supabase.from('users').select('name').eq('id', row.teacher_user_id).maybeSingle(),
    row.coach_user_id ? supabase.from('users').select('preferred_language').eq('id', row.coach_user_id).maybeSingle() : null,
    row.school_id ? supabase.from('leader_schools').select('school_name').eq('school_id', row.school_id) : null,
    deps.loadReport(supabase, row.coaching_session_id, row.teacher_user_id),
  ]);
  if (!data) return null;
  const { buildReportView } = require('./coaching-report-view');
  let noteUrl = null;
  if (row.voice_note_key) { try { noteUrl = (await presign(row.voice_note_key, 3600)) || null; } catch (_) { noteUrl = null; } }
  const c = (coach && coach.data) || {};
  const s = ((school && school.data) || [])[0] || {};
  return {
    teacher: fullNameOf((teacher && teacher.data) || {}) || '', school: s.school_name || '',
    language: c.preferred_language === 'ur' ? 'ur' : 'en', status: row.status, reasons: cleanReasons(row.reasons || []),
    noteUrl, view: buildReportView(data),
  };
}

/** "I have visited": the note is deleted from R2 and the row reads visited. true when the row was updated. */
async function markVisited(supabase, requestId, deps = {}) {
  const del = deps.del || ((key) => noteStore().del(key));
  try {
    const { data: row } = await supabase.from('coach_visit_requests').select('id, voice_note_key').eq('id', requestId).maybeSingle();
    if (!row) return false;
    if (row.voice_note_key) { try { await del(row.voice_note_key); } catch (_) { /* the visit still counts */ } }
    const { error } = await supabase.from('coach_visit_requests')
      .update({ status: 'visited', voice_note_key: null, updated_at: new Date().toISOString() }).eq('id', requestId);
    return !error;
  } catch (_) {
    return false;
  }
}

module.exports = { coachesFor, requestVisit, sendTemplate, loadCard, markVisited };
