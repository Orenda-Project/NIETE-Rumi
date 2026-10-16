'use strict';
/**
 * "KEEP MY PLACE" — the page side of binding a child to the family's WhatsApp phone, and the pick record.
 * Never throws: every failure is an answer the page can show (or nothing).
 *
 *   mint({hub, kid, device, lang})  the chosen child on the trusted phone -> {ok, code, expires_at, prefill:{en,ur}, href}
 *                                   (a second ask within the hour from the same device answers the same live code;
 *                                   `bind_confirm` is logged once per live code, so the funnel counts children, not taps)
 *                                   refusals {ok:false, refused:'teacher_phone'|'max_phones'}, {ok:false, error}
 *   status({code})                  {state:'pending'|'bound'|'refused'|'expired', reason?}
 *   undo({code})                    erases the ONE binding this code made -> {ok:true}; sends no message
 *   whoseTurn({hub, kid, device, lang})  a hub link with >= 2 trusted children and no tap this request ->
 *                                   {ask:'whose_turn', kids:[{chip, first, animal, line2?, homonym_in_list}]}, else null
 *   hubExtras(out, {token, chosen, rows, trust})  under the phone-bind switch: `bind` and the chips' line2/played
 *   recordPick({sessionId, via, studentId, device})  under the identity-canon switch: the pick's id_src/id_confidence/
 *                                   homonym_in_list/canonical_id kept 24 h for the run row, and `id_pick` emitted; with a
 *                                   device, the pointer wq:idpick:d:<canonical_id>:<sha256(device)[0:16]> -> {session_id, at}
 *                                   (the newest quiz start of this child on this phone), which the hub chip's record inherits
 *   pickFor(sessionId | {sessionId, canonicalId, device})  the quiz start's record, else the hub chip's record
 *                                   (wq:idpick:h:<canonical_id>:<sha256(device)[0:16]>, written by hubExtras), else null
 *   hubPickKey(canonicalId, device)  that hub record's Redis key (null without both); the one builder of the format
 *   canonOn() / bindOn()            the switches (false when the switch module is unavailable)
 *
 * Every function is a no-op ({off:true} or null) unless its switch is on. The phone number is never known
 * here (the page has none); a device_ref is never logged; the code row's device_ref is audit only.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const T = require('./web-quiz-token');
const Homonym = require('./web-quiz-homonym');
const K = require('./web-quiz-kid');

const CODE_RX = /^JUGNU-[A-Z2-9]{5}$/;
const MAX_PHONES_PER_CHILD = 3;
const PICK_TTL_S = 24 * 3600;
const PICK_PREFIX = 'wq:idpick:';
// wa.bind.prefill: the bot reads the code only, so it sits LAST (bidi cannot move it in Urdu).
const PREFILL = { en: 'Jugnu ✨ keep my place {code}', ur: 'جگنو ✨ میری جگہ محفوظ کریں {code}' };

async function idFlags() {
  try {
    return (await require('./web-quiz-identity-flags').flags()) || {};
  } catch (err) {
    return {};
  }
}
const canonOn = async () => Boolean((await idFlags()).canon);
const bindOn = async () => Boolean((await idFlags()).phoneBind);

// Events v2 (web_quiz_events_v2, fail-closed): the page's bind events carry the envelope with the child's keyed kid
// (and dk for the phone on bind_confirm); never a device_ref or a code. Off: today's event, byte for byte.
async function emitV2(name, fields, { canonicalId = null, device = null } = {}) {
  let v2 = false;
  try { v2 = await require('./web-quiz-hub-flags').eventsV2On(); } catch (_) { v2 = false; }
  if (!v2) return logEvent(name, { w: 's', ...fields });
  return logEvent(name, K.envelope({ kid: canonicalId ? K.kid(canonicalId) : null, ...(device ? { dk: K.dk(device) } : {}), ...fields }));
}

// The number a wa.me link must open: the same variables the share links read (video-quiz-share botNumber).
function botNumber() {
  return String(process.env.WHATSAPP_BOT_NUMBER || process.env.REFERRAL_BOT_NUMBER || '').replace(/\D/g, '');
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

/** The hub chip's child on a phone the hub trusts, or an error word. */
async function childOf(hub, kid, device) {
  const tok = T.verify(hub, 'h');
  if (!tok || !Array.isArray(tok.ids) || !tok.ids.length) return { error: 'bad_token' };
  const studentId = tok.ids.map(String).find((id) => T.chipId('h', id) === String(kid || ''));
  if (!studentId) return { error: 'bad_token' };
  const trust = await require('./web-quiz-hub-device').deviceTrusted(hub, device);
  if (!trust.ok || !trust.ids.includes(studentId)) return { error: 'other_device' };
  return { tok, studentId };
}

async function mint({ hub, kid, device, lang } = {}) {
  try {
    if (!(await bindOn())) return { off: true };
    const c = await childOf(hub, kid, device);
    if (c.error) return { ok: false, error: c.error };
    // A teacher's device never keeps a child's place. Today's hub token carries no persona claim (only the
    // teacher's preview token has `t`); a claim or a practice mode on the token is refused if it ever appears.
    if (c.tok.t || c.tok.mode === 'practice') return { ok: false, refused: 'teacher_phone' };
    const n = botNumber();
    if (!n) {
      logToFile('⚠️ keep my place: no bot number configured — no code minted', {});
      return { off: true };
    }
    const canonicalId = (await require('./web-quiz-identity-roster').canonicalStudentId(c.studentId)) || c.studentId;
    const active = await require('./child-phone-bindings.repo').activeForChild(canonicalId);
    if ((active || []).length >= MAX_PHONES_PER_CHILD) {
      // The page shows its three-phones line for this refusal; the server logs it.
      logEvent('web_quiz.bind_refused_page', { w: 's', reason: 'max_phones' });
      return { ok: false, refused: 'max_phones' };
    }
    const minted = await require('./child-bind-codes.repo').mint(canonicalId, T.cleanDeviceRef(device));
    if (!minted || !minted.code) return { ok: false, error: 'unavailable' };
    if (!minted.reused) await emitV2('web_quiz.bind_confirm', {}, { canonicalId, device });
    const prefill = { en: PREFILL.en.replace('{code}', minted.code), ur: PREFILL.ur.replace('{code}', minted.code) };
    const l = require('../../config/ux-strings').clampLanguage(lang);
    return { ok: true, code: minted.code, expires_at: minted.expires_at || null, prefill, href: `https://wa.me/${n}?text=${encodeURIComponent(prefill[l])}` };
  } catch (err) {
    logToFile('⚠️ keep my place: mint failed', { error: err.message });
    return { ok: false, error: 'unavailable' };
  }
}

async function status({ code } = {}) {
  try {
    if (!(await bindOn())) return { off: true };
    if (!CODE_RX.test(String(code || ''))) return { state: 'refused', reason: 'code_unknown' };
    const row = await require('./child-bind-codes.repo').get(String(code));
    if (!row) return { state: 'refused', reason: 'code_unknown' };
    if (row.used_at && row.outcome === 'bound') return { state: 'bound' };
    if (row.outcome === 'code_expired') return { state: 'expired' };
    if (row.used_at && row.outcome) return { state: 'refused', reason: String(row.outcome).replace(/^refused:?/, '') };
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return { state: 'expired' };
    return { state: 'pending' };
  } catch (err) {
    logToFile('⚠️ keep my place: status failed', { error: err.message });
    return { state: 'pending' };
  }
}

async function undo({ code } = {}) {
  try {
    if (!(await bindOn())) return { off: true };
    if (!CODE_RX.test(String(code || ''))) return { ok: false, error: 'not_bound' };
    const row = await require('./child-bind-codes.repo').get(String(code));
    if (!row || !row.used_at || row.outcome !== 'bound') return { ok: false, error: 'not_bound' };
    const Bindings = require('./child-phone-bindings.repo');
    // The binding has no code column, but the binder stamps the row it makes (confirmed_at on a new row,
    // last_played_at on a renewed one) with the SAME instant it marks the code used, so THE ONE binding this code made
    // is the child's active row carrying that instant; never "the newest" (another family's phone may be newer).
    const usedMs = Date.parse(row.used_at);
    const stamped = (b) => [b.confirmed_at, b.last_played_at].some((t) => t && Date.parse(t) === usedMs);
    const active = (await Bindings.activeForChild(row.canonical_id)) || [];
    // the row that names this code (code_id) first; a row written before that column existed, by the stamped instant
    const mine = active.find((b) => b.code_id && String(b.code_id) === String(code))
      || (Number.isFinite(usedMs) ? active.find((b) => !b.code_id && stamped(b)) : null);
    if (!mine) return { ok: false, error: 'not_bound' };
    // The repo returns the erased rows, each with the phone_norm it held before the erase, so the door forgets each.
    const erased = (await Bindings.eraseOne(mine.id, 'page_undo')) || [];
    const Sid = require('./student-identity.service');
    for (const e of erased) {
      if (e && e.phone_norm && typeof Sid.forgetDoorVerdict === 'function') await Sid.forgetDoorVerdict(e.phone_norm, e.phone_norm);
    }
    await emitV2('web_quiz.bind_undo', { via: 'page', n: erased.length }, { canonicalId: row.canonical_id });
    return { ok: true };
  } catch (err) {
    logToFile('⚠️ keep my place: undo failed', { error: err.message });
    return { ok: false, error: 'unavailable' };
  }
}

/** The chips of these children, through the homonym guard ('who': the father's first name as line 2). */
async function chipsOf(ids, { lang, played = [] } = {}) {
  const { data } = await supabase.from('students').select('id, student_name, student_name_urdu, father_name, is_active').in('id', ids);
  const rows = ids.map((id) => (data || []).find((r) => String(r.id) === String(id))).filter((r) => r && r.is_active !== false);
  const named = rows.map((r) => ({
    id: String(r.id), first: firstName(lang === 'ur' && r.student_name_urdu && String(r.student_name_urdu).trim() ? r.student_name_urdu : r.student_name),
    father_first: firstName(r.father_name) || null, avatar: T.animalFor(r.id),
  }));
  return Homonym.guard(named, { surface: 'who', playedHere: played });
}

async function whoseTurn({ hub, kid, device, lang } = {}) {
  try {
    if (kid) return null;
    const tok = T.verify(hub, 'h');
    if (!tok || !Array.isArray(tok.ids) || tok.ids.length < 2) return null;
    const trust = await require('./web-quiz-hub-device').deviceTrusted(hub, device);
    if (!trust.ok) return null;
    const ids = tok.ids.map(String).filter((id) => trust.ids.includes(id));
    if (ids.length < 2) return null;
    const chips = await chipsOf(ids, { lang, played: trust.why === 'played' ? trust.ids : [] });
    if (chips.length < 2) return null;
    return {
      ask: 'whose_turn',
      kids: chips.map((c) => ({ chip: T.chipId('h', c.id), first: c.first, animal: c.avatar, ...(c.line2 ? { line2: c.line2 } : {}), ...(c.avatarLine ? { avatarLine: c.avatarLine } : {}), homonym_in_list: c.homonym_in_list })),
    };
  } catch (err) {
    logToFile('⚠️ keep my place: whose turn failed', { error: err.message });
    return null;
  }
}

/**
 * The hub's boot JSON under web_quiz_phone_bind: the card's ticket for the chosen child (`bind`), and on the picker
 * ("Who is playing?") each chip's line2 / avatarLine / homonym_in_list / played. Off: `out` untouched.
 */
async function hubExtras(out, { token, chosen, rows = [], trust = {}, lang, device, src } = {}) {
  try {
    const f = await idFlags();
    if (f.canon && chosen) await recordHubPick({ chosen, rows, device, src });
    if (!f.phoneBind) return out;
    if (chosen) {
      out.bind = { offer: true, hub: token, kid: out.kid };
      return out;
    }
    out.bind = { offer: false };
    const played = trust.why === 'played' ? (trust.ids || []).map(String) : [];
    const guarded = await chipsOf(rows.map((r) => String(r.id)), { lang, played });
    out.kids = out.kids.map((k) => {
      const g = guarded.find((x) => T.chipId('h', x.id) === k.chip) || {};
      return { ...k, ...(g.line2 ? { line2: g.line2 } : {}), ...(g.avatarLine ? { avatarLine: g.avatarLine } : {}), homonym_in_list: Boolean(g.homonym_in_list), played: played.includes(String(g.id)) };
    });
    return out;
  } catch (err) {
    logToFile('⚠️ keep my place: hub extras failed', { error: err.message });
    return out;
  }
}

// A play opened from the hub has no quiz session: its pick is keyed by the child and this phone.
const devHash = (device) => {
  const d = T.cleanDeviceRef(device);
  return d ? require('crypto').createHash('sha256').update(d).digest('hex').slice(0, 16) : null;
};
const hubPickKey = (canonicalId, device) => {
  const h = devHash(device);
  return canonicalId && h ? `${PICK_PREFIX}h:${canonicalId}:${h}` : null;
};
// The newest quiz start of this child on this phone: a pointer to its session record, written beside it by recordPick.
const devPickKey = (canonicalId, device) => {
  const h = devHash(device);
  return canonicalId && h ? `${PICK_PREFIX}d:${canonicalId}:${h}` : null;
};

/** That quiz start's pick record, within its 24 h and naming this canonical child; null without one (or a preview's). */
async function sessionPickOnDevice(canonicalId, device) {
  const ptr = await readPick(devPickKey(canonicalId, device));
  if (!ptr || !ptr.session_id) return null;
  const rec = await readPick(PICK_PREFIX + String(ptr.session_id));
  if (!rec || !rec.id_src || String(rec.canonical_id || '') !== String(canonicalId)) return null;
  if (!(Number.isFinite(Number(rec.at)) && Date.now() - Number(rec.at) <= PICK_TTL_S * 1000)) return null;
  return rec;
}

/**
 * Is the canonical child joined to a roster: on a class list, or carrying merged_into (IDENTITY §1: `high` only through
 * a roster join; "My name isn't here" stays low until a teacher's join). A row that cannot be read counts as NOT
 * joined: a guess never puts a child into the trend (a low row is promoted later by the join itself, never edited).
 */
async function rosterJoined(canonicalId) {
  try {
    const { data, error } = await supabase.from('students').select('id, list_id, merged_into').eq('id', canonicalId).maybeSingle();
    if (error) throw new Error(error.message || 'students read failed');
    return Boolean(data && (data.list_id || data.merged_into));
  } catch (err) {
    logToFile('⚠️ keep my place: roster join read failed — the hub pick is written low', { error: err.message });
    return false;
  }
}

/**
 * A chip tap on the hub (identity canon switch): hub_chip from a WhatsApp /quiz link (src 'wa'); otherwise the pick of
 * the newest quiz start of this child on this phone (its id_src, id_confidence and homonym_in_list: the child who came
 * to the hub from the quiz they just played), and `remembered` only when no such pick exists. On top, a child joined to
 * no roster (no list, no merged_into) is written `low`, as `forced_new` when that quiz start said so. `at` is this tap's
 * instant (the serve's per-visit guard), never the quiz start's.
 */
async function recordHubPick({ chosen, rows = [], device, src }) {
  try {
    const canonicalId = (await require('./web-quiz-identity-roster').canonicalStudentId(chosen.id)) || chosen.id;
    const key = hubPickKey(canonicalId, device);
    if (!key) return null;
    const g = Homonym.guard(rows.map((r) => ({ id: String(r.id), first: r.student_name })), { surface: 'who' }).find((r) => r.id === String(chosen.id));
    let rec = { id_src: src === 'wa' ? 'hub_chip' : 'remembered', id_confidence: 'high', homonym_in_list: Boolean(g && g.homonym_in_list), canonical_id: canonicalId, at: Date.now() };
    const sp = src === 'wa' ? null : await sessionPickOnDevice(canonicalId, device);
    const joined = await rosterJoined(canonicalId);
    // a "My name isn't here" pick is stale once a join names the child: the chip is then a remembered roster child
    if (sp && !(sp.id_src === 'forced_new' && joined)) rec = { ...rec, id_src: sp.id_src, id_confidence: sp.id_confidence, homonym_in_list: Boolean(sp.homonym_in_list) };
    if (!joined) rec = { ...rec, id_confidence: 'low', ...(sp && sp.id_src === 'forced_new' ? { id_src: 'forced_new' } : {}) };
    await require('../cache/railway-redis.service').set(key, rec, PICK_TTL_S);
    logEvent('web_quiz.id_pick', { w: 's', id_src: rec.id_src, id_confidence: rec.id_confidence, homonym_in_list: rec.homonym_in_list, chips_k: rows.length });
    return rec;
  } catch (err) {
    logToFile('⚠️ keep my place: hub pick record failed', { error: err.message });
    return null;
  }
}

/** For a roster pick: did the child's class list hold another child with the same canon first name, and was it resolved? */
async function rosterHomonym(studentId) {
  const { data: me } = await supabase.from('students').select('id, list_id').eq('id', studentId).maybeSingle();
  if (!me || !me.list_id) return { homonym_in_list: false, resolved: true, k: 0 };
  const { data } = await supabase.from('students').select('id, student_name, father_name, is_active').eq('list_id', me.list_id).limit(200);
  const rows = (data || []).filter((r) => r.is_active !== false).map((r) => ({ id: String(r.id), first: r.student_name, father_first: firstName(r.father_name) || null }));
  const g = Homonym.guard(rows, { surface: 'q' }).find((r) => r.id === String(studentId));
  return { homonym_in_list: Boolean(g && g.homonym_in_list), resolved: !g || g.confidence === 'high', k: rows.length };
}

async function recordPick({ sessionId, via, studentId, device } = {}) {
  try {
    if (!sessionId || !(await canonOn())) return null;
    const src = Homonym.idSrcFromVia(via);
    let h = { homonym_in_list: false, resolved: true, k: 0 };
    if (src.id_src === 'roster_pick' && studentId) h = await rosterHomonym(studentId);
    const canonicalId = studentId ? ((await require('./web-quiz-identity-roster').canonicalStudentId(studentId)) || studentId) : null;
    const rec = {
      id_src: src.id_src,
      id_confidence: src.id_src ? Homonym.confidenceFor({ id_src: src.id_src, homonym_in_list: h.homonym_in_list, resolved: h.resolved }) : null,
      homonym_in_list: h.homonym_in_list,
      canonical_id: canonicalId,
      ...(src.mode ? { mode: src.mode } : {}),
      at: Date.now(),   // the instant of the pick, for a per-visit guard at the serve
    };
    const redis = require('../cache/railway-redis.service');
    await redis.set(PICK_PREFIX + sessionId, rec, PICK_TTL_S);
    // the newest quiz start of this child on this phone, for the hub chip's record to inherit (no device: no pointer)
    const dkey = canonicalId && rec.id_src ? devPickKey(canonicalId, device) : null;
    if (dkey) await redis.set(dkey, { session_id: String(sessionId), at: rec.at }, PICK_TTL_S);
    logEvent('web_quiz.id_pick', { w: 's', id_src: rec.id_src, id_confidence: rec.id_confidence, homonym_in_list: rec.homonym_in_list, chips_k: h.k });
    return rec;
  } catch (err) {
    logToFile('⚠️ keep my place: pick record failed', { error: err.message });
    return null;
  }
}

async function readPick(key) {
  if (!key) return null;
  const v = await require('../cache/railway-redis.service').get(key);
  return v && typeof v === 'object' ? v : null;
}

/** pickFor(sessionId) or pickFor({sessionId, canonicalId, device}): the session's record, else the hub's, else null. */
async function pickFor(arg) {
  try {
    const o = arg && typeof arg === 'object' ? arg : { sessionId: arg };
    return (o.sessionId ? await readPick(PICK_PREFIX + o.sessionId) : null)
      || (o.canonicalId && o.device ? await readPick(hubPickKey(String(o.canonicalId), o.device)) : null);
  } catch (_) {
    return null;
  }
}

module.exports = { mint, status, undo, whoseTurn, hubExtras, recordPick, pickFor, hubPickKey, canonOn, bindOn, CODE_RX, PREFILL };
