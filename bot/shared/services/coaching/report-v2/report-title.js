'use strict';
/**
 * Queue #230 — the teacher's observation report opens with a title block, not a sentence (the operator, 23 Nov ~16:05:
 * "on the Teacher Observation Report, the header looks plain shit. Its a urdu sentence"). The hero shows:
 *
 *   the rubric chip (FICO17 v6 · FICO 6-12 · FDE)                                   the score, as before
 *   Teacher Observation Report          (Urdu report: استاد کی مشاہداتی رپورٹ, in Nastaliq)
 *   the teacher's name
 *   the school
 *   Grade 7 · English · <the lesson's topic, where the page has one> · 23 Nov 2026
 *   Observed by <name> · Coach | Principal
 *
 * Every fact is read, never made: a fact that is not on file is left out, the line with it. The title and the labels
 * are in the report's language; names stay as stored. buildReportTitle is pure; loadTitleFacts reads the two users
 * (teacher and observer) and the HITL switch, and never throws. ON: only a report whose observer the HITL v6/v7 switch
 * (portal_coach_flow_v2) names; every other report keeps today's header until the switch reaches its observer.
 */

const WORDS = {
  en: {
    title: 'Teacher Observation Report',
    observedBy: (name, role) => [name ? `Observed by ${name}` : 'Observed', role].filter(Boolean).join(' · '),
    role: { coach: 'Coach', principal: 'Principal' },
    grade: (g) => `Grade ${g}`,
    // bd-r2uzg1.23.12 (queue #274, call 27A): whose report this is. The app's words (ict-niete-ontology §3b): her own
    // recording is a "DC observation"; a coach's or principal's visit is an "Observation".
    source: {
      dc: 'DC observation · from your own recording',
      visit: (who) => `Observation by ${who}`,
    },
    who: (name, rk) => [rk === 'principal' ? 'your principal' : 'your coach', name].filter(Boolean).join(' '),
  },
  ur: {
    title: 'استاد کی مشاہداتی رپورٹ',
    observedBy: (name, role) => [name ? `مشاہدہ: ${name}` : 'مشاہدہ', role].filter(Boolean).join(' · '),
    role: { coach: 'کوچ', principal: 'پرنسپل' },
    grade: (g) => `جماعت ${urDigits(g)}`,
    // bd-r2uzg1.23.12 (DRAFT for native review): the app's ڈیجیٹل کوچنگ مشاہدہ and مشاہدہ (ontology §3b).
    source: {
      dc: 'ڈیجیٹل کوچنگ مشاہدہ · آپ کی اپنی ریکارڈنگ سے',
      visit: (who) => `${who} کا مشاہدہ`,
    },
    who: (name, rk) => [rk === 'principal' ? 'آپ کے پرنسپل' : 'آپ کے کوچ', name].filter(Boolean).join(' '),
  },
};

const UR_MONTHS = ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function urDigits(n) { return String(n).replace(/[0-9]/g, (d) => String.fromCharCode(0x06F0 + Number(d))); }
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The visit's day in Pakistan time: "23 Nov 2026" / "۲۳ نومبر ۲۰۲۶"; null when there is no date. */
function titleDate(iso, lang) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pk = new Date(d.getTime() + 5 * 3600 * 1000); // Asia/Karachi: UTC+5, no daylight saving
  const day = pk.getUTCDate(); const m = pk.getUTCMonth(); const y = pk.getUTCFullYear();
  return lang === 'ur' ? `${urDigits(day)} ${UR_MONTHS[m]} ${urDigits(y)}` : `${day} ${EN_MONTHS[m]} ${y}`;
}

/** The observer's role as the report names it: a principal, else a coach (the only two who observe). */
function roleKey(role) {
  if (!role) return null;
  return /principal/i.test(String(role)) ? 'principal' : 'coach';
}

/**
 * The title block's words. Pure.
 * @param {object} f  { teacher, school, grade, subject, topic, at, observer, observerRole, rubric }
 * @param {string} lang  the report's language
 * @returns {{text:string, teacher:string|null, school:string|null, line:string|null, observer:string|null, rubric:string|null}}
 */
function buildReportTitle(f = {}, lang = 'en') {
  const { clampLanguage } = require('../../../config/ux-strings');
  const W = WORDS[clampLanguage(lang, ['en', 'ur'])];
  const grade = f.grade == null ? null : text(String(f.grade));
  const line = [grade ? W.grade(grade) : null, text(f.subject), text(f.topic), titleDate(f.at, lang)].filter(Boolean).join(' · ') || null;
  const rk = roleKey(f.observerRole);
  const observerName = text(f.observer);
  return {
    text: W.title,
    teacher: text(f.teacher),
    school: text(f.school),
    line,
    observer: observerName || rk ? W.observedBy(observerName, rk ? W.role[rk] : null) : null,
    rubric: text(f.rubric),
  };
}

/** The rubric's chip, from the analysis's stamp: what the report was scored on, or null. */
function rubricChip(analysis) {
  const a = analysis || {};
  const fw = String(a.framework || '').toLowerCase();
  if (fw.startsWith('fico_s')) return 'FICO 6-12';
  if (fw.startsWith('obs612')) return 'FDE';
  try {
    if (require('../frameworks/fico17-v6/stamp').isV6Scored(a)) return 'FICO17 v6';
  } catch (_) { /* no chip rather than a wrong one */ }
  return null;
}

/**
 * The teacher's name and school and the observer's name and role, read for the title. Never throws: on any failure
 * the facts it could not read are null and the block leaves them out.
 * @param {object} session  coaching_sessions row (user_id, observer_user_id)
 */
async function loadTitleFacts(session, deps = {}) {
  const out = { teacherName: null, school: null, observer: null, observerRole: null, hitl: false };
  const s = session || {};
  const ids = [s.user_id, s.observer_user_id].filter(Boolean);
  if (!ids.length) return out;
  let supabase;
  try {
    supabase = deps.supabase || require('../../../config/supabase');
    const { data } = await supabase.from('users').select('id, name, role, school_name').in('id', ids);
    const byId = Object.fromEntries((data || []).map((u) => [u.id, u]));
    const t = byId[s.user_id] || {};
    const o = (s.observer_user_id && byId[s.observer_user_id]) || {};
    out.teacherName = text(t.name);
    out.school = text(t.school_name);
    out.observer = text(o.name);
    out.observerRole = text(o.role);
  } catch (_) { return out; /* the title is drawn from what was read */ }
  // The title block rides the HITL v6/v7 switch (portal_coach_flow_v2), read with the portal's own rule for the
  // observer (observer-report-copy flowV6OnFor): the switch's accounts get it, every other report is as before. A
  // missing observer, no row or a failed read is off.
  try {
    if (s.observer_user_id) {
      const { flowV6OnFor, SWITCH_KEYS } = require('../../observe/observer-report-copy');
      const { data: rows, error } = await supabase.from('app_settings').select('key,value').in('key', SWITCH_KEYS);
      if (!error) {
        const values = new Map((rows || []).map((r) => [r.key, r.value]));
        out.hitl = flowV6OnFor(values, { id: s.observer_user_id, role: out.observerRole }) === true;
      }
    }
  } catch (_) { out.hitl = false; }
  return out;
}

/**
 * bd-r2uzg1.23.12 (queue #274, call 27A; ICT sheet HITL 44, 45): "your coach Ayesha Khan" / "آپ کے کوچ Ayesha Khan".
 * The observer as the teacher knows her: coach or principal, then the name. A name not on file is left out, never
 * made up. Other languages (the observe pack's sw): the name alone, as before. Pure.
 */
function observerLabel(name, role, lang) {
  const l = String(lang || 'en').toLowerCase();
  if (!WORDS[l]) return text(name) || '';
  return WORDS[l].who(text(name), roleKey(role) || 'coach');
}

/**
 * Whose report this is, in the report's language (en, ur; anything else en). Pure.
 *   her own recording (no observer, not an observation)  "DC observation · from your own recording"
 *   a coach's or principal's visit                       "Observation by your coach Ayesha Khan"
 * @param {object} session  coaching_sessions row (observer_user_id, observation_type)
 * @param {object} facts    { observer, observerRole } (loadTitleFacts)
 */
function reportSource(session, facts = {}, lang = 'en') {
  const { clampLanguage } = require('../../../config/ux-strings');
  const l = clampLanguage(lang, ['en', 'ur']);
  const s = session || {};
  const visit = Boolean(s.observer_user_id) || s.observation_type === 'leader_observation';
  if (!visit) return WORDS[l].source.dc;
  const f = facts || {};
  return WORDS[l].source.visit(WORDS[l].who(text(f.observer), roleKey(f.observerRole) || 'coach'));
}

module.exports = { buildReportTitle, loadTitleFacts, rubricChip, titleDate, WORDS, observerLabel, reportSource };
