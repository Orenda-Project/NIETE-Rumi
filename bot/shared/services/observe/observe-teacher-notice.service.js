'use strict';
/**
 * bd-xorfy — tell the teacher about her own observation visit.
 *
 * A coach books, moves or cancels a visit (in WhatsApp /observe, or on the
 * portal) and the teacher used to hear nothing until the coach walked into her
 * classroom. This sends her the date and time on WhatsApp, in her language.
 *
 * RULES, SAME DISCIPLINE AS observe-calendar
 * ------------------------------------------
 * 1. **The notice may never break the scheduling.** Every path returns a
 *    boolean and none throws. A Meta rejection, an unapproved template or a
 *    missing users row leaves the coach's visit saved exactly as it was.
 * 2. **No phone, no notice.** teacher_ext_id is the teacher's phone for rows
 *    keyed on a Rumi teacher; an off-Rumi teacher is keyed by a name slug and
 *    has no number to send to. We never look a phone up by name.
 * 3. **Her language, not the coach's.** Read from HER users row, clamped to
 *    this market (observe-language), market default when unset.
 *
 * ROLLOUT
 * -------
 * OBSERVE_TEACHER_NOTIFY_ENABLED, default OFF — the templates must be approved
 * on the WABA before anything is sent.
 *   unset / 'false' / ''  — dormant, zero calls
 *   'true'                — every coach
 *   'id-a,id-b'           — only those leader_user_ids
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { templateCodeFor, DEFAULT_LANGUAGE } = require('../../config/languages');
const { clampToMarket, marketDefault } = require('./observe-language');
const { TEMPLATES } = require('../../templates/observe-visit-notice.template');

const KINDS = Object.keys(TEMPLATES);

const COPY = {
  en_US: {
    coach: 'Your coach',
    teacher: 'Teacher',
    noTime: 'To be confirmed by your coach',
    dayJoin: ', ',
    clock: (h, h12, mm) => `${h12}:${mm} ${h < 12 ? 'AM' : 'PM'}`,
    days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July',
      'August', 'September', 'October', 'November', 'December'],
  },
  ur: {
    coach: 'آپ کے کوچ',
    teacher: 'محترم استاد',
    noTime: 'کوچ بعد میں بتائیں گے',
    dayJoin: '، ',
    clock: (h, h12, mm) => {
      let part = 'رات';
      if (h < 12) part = 'صبح';
      else if (h < 16) part = 'دوپہر';
      else if (h < 19) part = 'شام';
      return `${part} ${h12}:${mm}`;
    },
    days: ['اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ'],
    months: ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی',
      'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'],
  },
};

/** Read at call time; a worker outlives any one env snapshot. */
function _enabledFor(leaderUserId) {
  const raw = (process.env.OBSERVE_TEACHER_NOTIFY_ENABLED || '').trim();
  if (!raw || raw === 'false' || raw === '0') return false;
  if (raw === 'true') return true;
  return raw.split(',').map((s) => s.trim()).filter(Boolean).includes(String(leaderUserId));
}

/** The teacher's number, or null for a name-slug (off-Rumi) teacher. */
function _phoneOf(teacherExtId) {
  const s = String(teacherExtId == null ? '' : teacherExtId).replace(/[\s-]/g, '');
  return /^\+?\d{10,15}$/.test(s) ? s.replace(/^\+/, '') : null;
}

const _s = (v) => {
  const t = String(v == null ? '' : v).trim();
  return t || null;
};

async function _user(column, value, fields) {
  try {
    const { data, error } = await supabase.from('users').select(fields).eq(column, value).maybeSingle();
    return error ? null : data || null;
  } catch (_) {
    return null;
  }
}

/** 'YYYY-MM-DD' → "Thursday, 8 October 2026" / "جمعرات، 8 اکتوبر 2026". */
function formatDate(isoDate, copy) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(isoDate || '');
  const day = copy.days[d.getUTCDay()];
  const date = `${d.getUTCDate()} ${copy.months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `${day}${copy.dayJoin}${date}`;
}

/** 'HH:MM' → "9:30 AM" / "صبح 9:30"; no slot → "to be confirmed". */
function formatTime(slot, copy) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(slot || ''));
  if (!m) return copy.noTime;
  const h = Number(m[1]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return copy.clock(h, h12, m[2]);
}

/**
 * @param {'scheduled'|'rescheduled'|'cancelled'} kind
 * @param {object} row an observation_schedules row (leader_user_id, teacher_ext_id,
 *   teacher_name, school_name, scheduled_for, scheduled_slot)
 * @returns {Promise<boolean>} true only when Meta accepted the send
 */
async function notifyTeacher(kind, row) {
  try {
    if (!row || !KINDS.includes(kind)) return false;
    if (!_enabledFor(row.leader_user_id)) return false;
    const phone = _phoneOf(row.teacher_ext_id);
    if (!phone) {
      logToFile('observe-teacher-notice: no phone for teacher — skipped', {
        scheduleId: row.id, kind,
      });
      return false;
    }

    const teacher = await _user('phone_number', row.teacher_ext_id, 'name, preferred_language');
    const coach = await _user('id', row.leader_user_id, 'name');

    const lang = clampToMarket(teacher && teacher.preferred_language) || marketDefault();
    // Meta locale code; anything we hold no copy for gets the emergency floor.
    let code = templateCodeFor(lang);
    if (!COPY[code]) code = templateCodeFor(DEFAULT_LANGUAGE);
    const copy = COPY[code];

    const values = [
      _s(teacher && teacher.name) || _s(row.teacher_name) || copy.teacher,
      _s(coach && coach.name) || copy.coach,
      _s(row.school_name) || '—',
      formatDate(row.scheduled_for, copy),
      formatTime(row.scheduled_slot, copy),
    ];
    const components = [{
      type: 'body',
      parameters: values.map((text) => ({ type: 'text', text })),
    }];

    const WhatsAppService = require('../whatsapp.service');
    const sent = await WhatsAppService.sendTemplate(phone, TEMPLATES[kind].name, code, components);
    logToFile(sent ? 'observe-teacher-notice: sent' : '❌ observe-teacher-notice: send rejected', {
      scheduleId: row.id, kind, template: TEMPLATES[kind].name, language: code, to: phone.slice(-4),
    }, sent ? 'info' : 'error');
    return !!sent;
  } catch (err) {
    logToFile('❌ observe-teacher-notice: failed (non-blocking)', {
      scheduleId: row && row.id, kind, error: err.message,
    }, 'error');
    return false;
  }
}

module.exports = { notifyTeacher, formatDate, formatTime, _enabledFor, _phoneOf, KINDS };
